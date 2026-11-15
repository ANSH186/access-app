#!/usr/bin/env python3
"""Build the placeholder Lab Block map (CONTRACT section 3).

Writes lab_block.json (next to this script) and ../../supabase/seed.sql.
Standard library only.  Run:  python3 build_map.py
"""
import json
import math
import os
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_PATH = os.path.normpath(os.path.join(HERE, "..", "..", "supabase", "seed.sql"))
JSON_PATH = os.path.join(HERE, "lab_block.json")

NS = uuid.UUID("6f1c2a1e-7d1b-4c5e-9a43-2b8f0d7e4a10")
INSTITUTION_ID = "00000000-0000-0000-0000-000000000001"
INSTITUTION_NAME = "NIE Mysore (pilot)"
BUILDING_NOTE = "Placeholder layout derived from one courtyard photo — correct on site"
LIFT_NOTE = "Position not confirmed — check on site"
ENTRANCE_NOTE = "Position assumed — check on site"


def uid(code):
    return str(uuid.uuid5(NS, code))


FLOORS = [("G", 0, "Ground floor"), ("1", 1, "Floor 1"), ("2", 2, "Floor 2"), ("3", 3, "Floor 3")]

RING = [("SW", 0, 0), ("S1", 10, 0), ("SM", 15, 0), ("S2", 20, 0), ("SE", 30, 0),
        ("E0", 30, 6), ("E1", 30, 11), ("E2", 30, 22), ("E3", 30, 34), ("NE", 30, 45),
        ("N2", 20, 45), ("N1", 10, 45), ("NW", 0, 45), ("W3", 0, 34), ("W2", 0, 22),
        ("W1", 0, 11)]

CORNER_DESC = {
    "SW": "south-west corner", "S1": "south corridor, west part", "SM": "south corridor, middle",
    "S2": "south corridor, east part", "SE": "south-east corner", "E0": "east corridor, south end",
    "E1": "east corridor, south part", "E2": "east corridor, middle", "E3": "east corridor, north part",
    "NE": "north-east corner", "N2": "north corridor, east part", "N1": "north corridor, west part",
    "NW": "north-west corner", "W3": "west corridor, north part", "W2": "west corridor, middle",
    "W1": "west corridor, south part",
}

# (suffix, label, kind, attach node, extra aliases)
LAB = "lab"
ROOMS = {
    "G": [
        ("HELPDESK", "Help desk", "help_desk", "S1", ["reception", "security", "help"]),
        ("LABG01", "Lab G01", LAB, "W1", []),
        ("LABG02", "Lab G02", LAB, "W2", []),
        ("LABG03", "Lab G03", LAB, "W3", []),
        ("WORKSHOP", "Workshop", "room", "E2", ["work shop"]),
        ("LABG04", "Lab G04", LAB, "E3", []),
    ],
    "1": [
        ("LAB101", "Lab 101", LAB, "W1", []), ("LAB102", "Lab 102", LAB, "W2", []),
        ("LAB103", "Lab 103", LAB, "W3", []),
        ("CSEOFFICE", "CSE Department Office", "office", "N2",
         ["department office", "cse office", "hod office", "office", "cse"]),
        ("LAB104", "Lab 104", LAB, "E3", []), ("LAB105", "Lab 105", LAB, "E2", []),
        ("LAB106", "Lab 106", LAB, "E1", []),
    ],
    "2": [
        ("LIBRARY", "Department Library", "library", "N2", ["library", "reading room"]),
        ("LAB201", "Lab 201", LAB, "W1", []), ("LAB202", "Lab 202", LAB, "W2", []),
        ("LAB203", "Lab 203", LAB, "W3", []),
        ("SEMINAR", "Seminar Hall", "room", "E2", ["seminar", "hall", "seminar room"]),
        ("LAB204", "Lab 204", LAB, "E3", []),
    ],
    "3": [
        ("RESEARCH", "Research Lab", LAB, "N2", ["research"]),
        ("STAFFROOM", "Staff Room", "office", "W2", ["staff", "faculty room", "staffroom"]),
        ("LAB301", "Lab 301", LAB, "W1", []), ("LAB302", "Lab 302", LAB, "W3", []),
        ("LAB303", "Lab 303", LAB, "E2", []), ("LAB304", "Lab 304", LAB, "E3", []),
    ],
}

QR = {"LB-G-ENTRANCE": "AA-CP-G-ENTRANCE", "LB-G-NW": "AA-CP-G-LIFT",
      "LB-1-E0": "AA-CP-1-SESTAIR", "LB-2-NW": "AA-CP-2-LIFT",
      "LB-2-N2": "AA-CP-2-LIBRARY", "LB-3-NW": "AA-CP-3-LIFT"}


def r1(v):
    return round(v + 0.0, 1)


def make_aliases(label, extra):
    words = label.lower().split()
    out = [label.lower()]
    if len(words) > 1:
        out.append("".join(words))
        out.extend(w for w in words if w not in ("floor", "the"))
    # lab numbers on their own, e.g. "101", "g01"
    if words[0] == "lab" and len(words) == 2:
        out.append(words[1])
    out.extend(extra)
    seen, res = set(), []
    for a in out:
        a = a.lower()
        if a not in seen:
            seen.add(a)
            res.append(a)
    return res


def build():
    floors, nodes, edges = [], [], []
    pos = {}  # code -> (x, y)
    floor_of = {}

    def add_node(fcode, suffix, kind, label, x, y, aliases=None, searchable=False, notes=None):
        code = f"LB-{fcode}-{suffix}"
        nodes.append({"id": uid(code), "code": code, "floor_code": f"LB-{fcode}", "kind": kind,
                      "label": label, "aliases": aliases or [], "x": x, "y": y,
                      "searchable": searchable, "qr_token": QR.get(code), "verified": False,
                      "notes": notes})
        pos[code] = (x, y)
        return code

    def add_edge(a, b, kind, step_free, length=None):
        if length is None:
            length = math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1])
        code = f"{a}__{b}"
        edges.append({"id": uid(code), "code": code, "from_code": a, "to_code": b, "kind": kind,
                      "length_m": r1(length), "step_free": step_free, "status": "open",
                      "verified": False})

    for fc, level, fname in FLOORS:
        floors.append({"id": uid(f"LB-{fc}"), "code": f"LB-{fc}", "level": level, "name": fname})
        # ring
        for name, x, y in RING:
            add_node(fc, name, "corridor", f"{fname}, {CORNER_DESC[name]}", x, y)
        for i in range(len(RING)):
            a = f"LB-{fc}-{RING[i][0]}"
            b = f"LB-{fc}-{RING[(i + 1) % len(RING)][0]}"
            if a.endswith("-N2") and b.endswith("-N1"):
                a, b = b, a  # CONTRACT names the demo edge LB-<L>-N1__LB-<L>-N2 (overrides ring order)
            add_edge(a, b, "corridor", True)
        # vertical cores
        n = add_node(fc, "NSTAIR", "stairs", f"North staircase, {fname}", 10, 48)
        add_edge(f"LB-{fc}-N1", n, "door", False, 3)
        n = add_node(fc, "SESTAIR", "stairs", f"South-east staircase, {fname}", 33, 6)
        add_edge(f"LB-{fc}-E0", n, "door", False, 3)
        n = add_node(fc, "LIFT", "lift", f"Lift, {fname}", -3, 45, notes=LIFT_NOTE)
        add_edge(f"LB-{fc}-NW", n, "door", True, 3)
        # rooms
        if fc == "G":
            e = add_node("G", "ENTRANCE", "entrance", "Main entrance (assumed position)", 15, -4,
                         ["main entrance", "entrance", "entry", "gate", "main gate", "front door"],
                         True, ENTRANCE_NOTE)
            add_edge("LB-G-SM", e, "door", True, 4)
        for suffix, label, kind, att, extra in ROOMS[fc]:
            ax, ay = pos[f"LB-{fc}-{att}"]
            if att.startswith("W"):
                x, y = ax - 3, ay
            elif att.startswith("E"):
                x, y = ax + 3, ay
            elif att.startswith("N"):
                x, y = ax, ay + 3
            else:
                x, y = ax, ay - 3
            code = add_node(fc, suffix, kind, label, x, y, make_aliases(label, extra), True)
            add_edge(f"LB-{fc}-{att}", code, "door", True, 3)
        wl = f"{fname} washroom" if fc == "G" else f"Floor {fc} washroom"
        w = add_node(fc, "WASHROOM", "washroom", wl, 33, 45,
                     make_aliases(wl, ["toilet", "restroom", "bathroom", "washroom", "toilets", "loo"]),
                     True)
        add_edge(f"LB-{fc}-NE", w, "door", True, 3)
        if fc == "G":
            c = add_node("G", "COURTYARD", "emergency_point", "Courtyard assembly area", 15, 22.5,
                         ["courtyard", "assembly area", "assembly point", "lawn", "garden",
                          "courtyard assembly area", "emergency assembly point"], True)
            add_edge("LB-G-W2", c, "outdoor", False, 15)

    # inter-floor
    for i in range(len(FLOORS) - 1):
        lo, hi = FLOORS[i][0], FLOORS[i + 1][0]
        for core in ("NSTAIR", "SESTAIR"):
            add_edge(f"LB-{lo}-{core}", f"LB-{hi}-{core}", "stairs", False, 12)
        add_edge(f"LB-{lo}-LIFT", f"LB-{hi}-LIFT", "lift", True, 4)

    building = {"id": uid("LB"), "code": "LB", "name": "Lab Block", "lat": None, "lng": None,
                "is_placeholder": True, "notes": BUILDING_NOTE}
    return {"institution_id": INSTITUTION_ID, "building": building, "floors": floors,
            "nodes": nodes, "edges": edges}


# ---------------------------------------------------------------- SQL

def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def arr(items):
    if not items:
        return "ARRAY[]::text[]"
    return "ARRAY[" + ", ".join(q(i) for i in items) + "]"


def make_sql(m):
    b = m["building"]
    fl = {f["code"]: f["id"] for f in m["floors"]}
    nid = {n["code"]: n["id"] for n in m["nodes"]}
    o = ["-- GENERATED by data/sample-campus/build_map.py -- do not edit by hand.",
         "-- Placeholder Lab Block map. Idempotent: safe to run repeatedly.",
         "-- Re-running refreshes geometry/labels but never resets node/edge `verified`,",
         "-- and never resets an edge's `status` (live blocks survive a re-seed).",
         "BEGIN;", ""]
    o.append("INSERT INTO public.institutions (id, name, test_mode_only) VALUES "
             f"({q(INSTITUTION_ID)}, {q(INSTITUTION_NAME)}, true)\nON CONFLICT (id) DO NOTHING;\n")
    o.append("INSERT INTO public.buildings (id, institution_id, code, name, lat, lng, is_placeholder, notes) VALUES\n"
             f"  ({q(b['id'])}, {q(INSTITUTION_ID)}, {q(b['code'])}, {q(b['name'])}, NULL, NULL, true, {q(b['notes'])})\n"
             "ON CONFLICT (id) DO UPDATE SET institution_id = EXCLUDED.institution_id, code = EXCLUDED.code,\n"
             "  name = EXCLUDED.name, is_placeholder = EXCLUDED.is_placeholder, notes = EXCLUDED.notes;\n")
    rows = [f"  ({q(f['id'])}, {q(b['id'])}, {q(f['code'])}, {f['level']}, {q(f['name'])})" for f in m["floors"]]
    o.append("INSERT INTO public.floors (id, building_id, code, level, name) VALUES\n" + ",\n".join(rows) +
             "\nON CONFLICT (id) DO UPDATE SET building_id = EXCLUDED.building_id, code = EXCLUDED.code,\n"
             "  level = EXCLUDED.level, name = EXCLUDED.name;\n")
    rows = []
    for n in m["nodes"]:
        rows.append(f"  ({q(n['id'])}, {q(fl[n['floor_code']])}, {q(n['code'])}, {q(n['kind'])}, {q(n['label'])}, "
                    f"{arr(n['aliases'])}, {q(n['x'])}, {q(n['y'])}, {q(n['searchable'])}, {q(n['qr_token'])}, "
                    f"{q(n['verified'])}, {q(n['notes'])})")
    o.append("INSERT INTO public.route_nodes (id, floor_id, code, kind, label, aliases, x, y, searchable, qr_token, verified, notes) VALUES\n"
             + ",\n".join(rows) +
             "\nON CONFLICT (id) DO UPDATE SET floor_id = EXCLUDED.floor_id, code = EXCLUDED.code, kind = EXCLUDED.kind,\n"
             "  label = EXCLUDED.label, aliases = EXCLUDED.aliases, x = EXCLUDED.x, y = EXCLUDED.y,\n"
             "  searchable = EXCLUDED.searchable, qr_token = EXCLUDED.qr_token, notes = EXCLUDED.notes;\n")
    rows = []
    for e in m["edges"]:
        rows.append(f"  ({q(e['id'])}, {q(e['code'])}, {q(nid[e['from_code']])}, {q(nid[e['to_code']])}, {q(e['kind'])}, "
                    f"{q(e['length_m'])}, {q(e['step_free'])}, {q(e['status'])}, {q(e['verified'])})")
    o.append("INSERT INTO public.route_edges (id, code, from_node_id, to_node_id, kind, length_m, step_free, status, verified) VALUES\n"
             + ",\n".join(rows) +
             "\nON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, from_node_id = EXCLUDED.from_node_id,\n"
             "  to_node_id = EXCLUDED.to_node_id, kind = EXCLUDED.kind, length_m = EXCLUDED.length_m,\n"
             "  step_free = EXCLUDED.step_free;\n")
    o.append("COMMIT;\n")
    return "\n".join(o)


def main():
    m = build()
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.makedirs(os.path.dirname(SEED_PATH), exist_ok=True)
    with open(SEED_PATH, "w", encoding="utf-8") as f:
        f.write(make_sql(m))
    print(f"wrote {JSON_PATH}\nwrote {SEED_PATH}\n{len(m['nodes'])} nodes, {len(m['edges'])} edges")


if __name__ == "__main__":
    main()
