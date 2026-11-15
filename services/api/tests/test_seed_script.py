import httpx
import respx

from scripts import seed_demo_users as s

BASE = "https://proj.supabase.co"


@respx.mock
def test_seed_creates_and_skips_existing():
    created = respx.post(f"{BASE}/auth/v1/admin/users")
    created.side_effect = [
        httpx.Response(200, json={"id": "u-new"}),
        httpx.Response(422, json={"error_code": "email_exists"}),
    ]
    respx.get(f"{BASE}/auth/v1/admin/users").mock(
        return_value=httpx.Response(200, json={"users": [{"id": "u-old", "email": "admin@accessable.demo"}]})
    )
    roles = respx.post(f"{BASE}/rest/v1/role_assignments").mock(return_value=httpx.Response(201))
    with httpx.Client() as c:
        assert s.ensure_user(c, BASE, "k", "student@accessable.demo", "S") == ("u-new", True)
        assert s.ensure_user(c, BASE, "k", "admin@accessable.demo", "A") == ("u-old", False)
        s.add_role(c, BASE, "k", "u-old", "admin")
    sent = roles.calls.last.request
    assert b'"role":"admin"' in sent.content.replace(b" ", b"")
    assert "ignore-duplicates" in sent.headers["prefer"]
    assert sent.headers["apikey"] == "k"
