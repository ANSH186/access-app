"""End-to-end check of the TechExpo demo story on a local stack.

Needs: a Postgres DB built from 00_supabase_stub.sql + migrations + seed.sql, three users
(student/admin/responder, ids below) and the API running with MAP_SOURCE=db and DEV_AUTH=1.

    python3 e2e_demo_flow.py --db "postgresql://postgres@/aa_e2e?host=/tmp&port=54329" --api http://localhost:8765
"""
import argparse
import asyncio
import json
import uuid

import asyncpg
import httpx

STUDENT = "11111111-1111-1111-1111-111111111111"
ADMIN = "22222222-2222-2222-2222-222222222222"
RESPONDER = "33333333-3333-3333-3333-333333333333"
NS = uuid.UUID("6f1c2a1e-7d1b-4c5e-9a43-2b8f0d7e4a10")


def nid(code: str) -> str:
    return str(uuid.uuid5(NS, code))


async def as_user(conn, uid, sql, *args):
    """Run one statement as `uid` the way Supabase would (role authenticated + JWT claims)."""
    async with conn.transaction():
        await conn.execute("set local role authenticated")
        await conn.execute("select set_config('request.jwt.claims', $1, true)",
                           json.dumps({"sub": uid, "role": "authenticated"}))
        return await conn.fetch(sql, *args)


def say(msg):
    print(f"  ✓ {msg}")


async def main(db, api):
    conn = await asyncpg.connect(db)
    http = httpx.Client(base_url=api, timeout=10)
    H = lambda uid: {"X-Dev-User": uid}

    print("1. Student scans the ground-floor lift checkpoint")
    cp = (await as_user(conn, STUDENT, "select * from resolve_checkpoint($1)", "AA-CP-G-LIFT"))[0]
    assert cp["node_id"] == uuid.UUID(nid("LB-G-NW")), cp
    say(f"checkpoint → {cp['floor_name']}, node {cp['node_code']}")

    print("2. 'Take me to the library'")
    r = http.get("/v1/destinations/search", params={"q": "library"}, headers=H(STUDENT)).json()
    lib = r["results"][0]
    assert lib["code"] == "LB-2-LIBRARY", r
    plan = http.post("/v1/routes/plan", headers=H(STUDENT), json={
        "from_node_id": str(cp["node_id"]), "to_node_id": lib["node_id"], "avoid_stairs": False}).json()
    assert plan["found"] and plan["explanation"] is None, plan
    normal_len = plan["total_length_m"]
    say(f"route found, {normal_len:.0f} m, {len(plan['steps'])} steps")
    for s in plan["steps"]:
        print("      -", s["instruction"])

    print("3. Another student reports a blocked corridor (node only, like the phone app)")
    rep = (await as_user(conn, STUDENT,
        "insert into obstacle_reports (category, description, node_id) values ('blocked_path', 'Chairs stacked across the corridor', $1) returning id, status",
        uuid.UUID(nid("LB-2-N1"))))[0]
    assert rep["status"] == "submitted"
    say("report stored as submitted")

    print("4. Admin verifies and blocks the Floor 2 north corridor")
    await as_user(conn, ADMIN, "select report_transition($1, 'verified', 'Checked on site', true, null, $2)",
                  rep["id"], uuid.UUID(nid("LB-2-N1__LB-2-N2")))
    st = await conn.fetchval("select status from route_edges where code = 'LB-2-N1__LB-2-N2'")
    assert st == "blocked"
    say("edge is blocked")

    print("5. Student's route recalculates")
    plan2 = http.post("/v1/routes/plan", headers=H(STUDENT), json={
        "from_node_id": str(cp["node_id"]), "to_node_id": lib["node_id"], "avoid_stairs": False}).json()
    assert plan2["found"] and plan2["total_length_m"] > normal_len and plan2["explanation"], plan2
    say(f"{normal_len:.0f} m → {plan2['total_length_m']:.0f} m")
    print("      explanation:", plan2["explanation"])

    print("6. Student sends a TEST SOS from the last confirmed checkpoint")
    alert = (await as_user(conn, STUDENT, """select * from create_emergency(
        p_client_request_id => $1, p_emergency_type => 'lost', p_node_id => $2,
        p_location_source => 'qr_checkpoint', p_location_label => 'Ground floor, near the lift',
        p_location_observed_at => now() - interval '3 minutes', p_is_test => true)""",
        "demo-" + uuid.uuid4().hex, cp["node_id"]))[0]
    assert alert["status"] == "triggered" and alert["is_test"]
    again = (await as_user(conn, STUDENT, "select * from create_emergency($1)", "different-key"))[0]
    assert again["id"] == alert["id"], "second SOS while one is active must return the same alert"
    say("alert triggered (test mode); a second press returns the same alert")

    print("7. Responder sees it and works it")
    seen = await as_user(conn, RESPONDER, "select id from emergency_alerts where status = 'triggered'")
    assert any(x["id"] == alert["id"] for x in seen)
    prof = await as_user(conn, RESPONDER, "select display_name from profiles where id = $1", uuid.UUID(STUDENT))
    assert prof, "responder should see the alerting student's profile"
    await as_user(conn, RESPONDER, "select emergency_acknowledge($1)", alert["id"])
    await as_user(conn, RESPONDER, "select emergency_set_status($1, 'responding', 'On my way from the gate')", alert["id"])
    try:
        await as_user(conn, RESPONDER, "select emergency_set_status($1, 'resolved', null)", alert["id"])
        raise AssertionError("resolve without a note must fail")
    except asyncpg.RaiseError as e:
        say(f"resolve without note refused: {e}")
    await as_user(conn, RESPONDER, "select emergency_set_status($1, 'resolved', 'Student escorted to the library (test)')", alert["id"])
    say("acknowledged → responding → resolved")

    print("8. Student's view of the alert")
    row = (await as_user(conn, STUDENT, "select status, acknowledged_at from emergency_alerts where id = $1", alert["id"]))[0]
    ev = await as_user(conn, STUDENT, "select event_type, to_status, note from emergency_events where alert_id = $1 order by id", alert["id"])
    assert row["status"] == "resolved" and row["acknowledged_at"]
    assert all(e["note"] != "On my way from the gate" for e in ev), "internal note leaked to student"
    say(f"student sees status '{row['status']}' and {len(ev)} timeline events, no internal notes")

    print("9. Maintenance clears it; admin resolves the report and the corridor reopens")
    await as_user(conn, ADMIN, "select report_transition($1, 'resolved', 'Chairs moved')", rep["id"])
    plan3 = http.post("/v1/routes/plan", headers=H(STUDENT), json={
        "from_node_id": str(cp["node_id"]), "to_node_id": lib["node_id"], "avoid_stairs": False}).json()
    assert abs(plan3["total_length_m"] - normal_len) < 0.01
    say("route back to normal")

    print("10. Evidence: event log cannot be edited")
    try:
        await conn.execute("update emergency_events set note = 'tampered' where alert_id = $1", alert["id"])
        raise AssertionError("event log must be append-only")
    except asyncpg.RaiseError as e:
        say(f"tamper attempt refused: {e}")

    await conn.close()
    print("\nEND-TO-END DEMO FLOW: PASS")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--api", default="http://localhost:8765")
    a = ap.parse_args()
    asyncio.run(main(a.db, a.api))
