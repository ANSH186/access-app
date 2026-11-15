"""Create the 5 demo users (CONTRACT section 5) and their role_assignments.

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role key = secret, never commit it).
Safe to re-run: existing users are skipped, existing roles are ignored.
Usage: python scripts/seed_demo_users.py
"""
from __future__ import annotations

import os
import sys

import httpx

INSTITUTION_ID = "00000000-0000-0000-0000-000000000001"
PASSWORD = "Demo@12345"
DEMO_USERS = [
    ("student@accessable.demo", "Demo Student", None),
    ("admin@accessable.demo", "Demo Admin", "admin"),
    ("responder@accessable.demo", "Demo Responder", "responder"),
    ("maintenance@accessable.demo", "Demo Maintenance", "maintenance"),
    ("mapeditor@accessable.demo", "Demo Map Editor", "map_editor"),
]


def _headers(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def find_user_id(client: httpx.Client, base: str, key: str, email: str) -> str | None:
    page = 1
    while True:
        r = client.get(f"{base}/auth/v1/admin/users", params={"page": page, "per_page": 200}, headers=_headers(key))
        r.raise_for_status()
        users = r.json().get("users", [])
        for u in users:
            if (u.get("email") or "").lower() == email:
                return u["id"]
        if len(users) < 200:
            return None
        page += 1


def ensure_user(client: httpx.Client, base: str, key: str, email: str, name: str) -> tuple[str, bool]:
    """Returns (user_id, created)."""
    r = client.post(
        f"{base}/auth/v1/admin/users",
        headers=_headers(key),
        json={"email": email, "password": PASSWORD, "email_confirm": True, "user_metadata": {"display_name": name}},
    )
    if r.status_code in (200, 201):
        return r.json()["id"], True
    if r.status_code in (409, 422):  # already registered
        uid = find_user_id(client, base, key, email)
        if uid:
            return uid, False
    r.raise_for_status()
    raise RuntimeError(f"could not create {email}")


def add_role(client: httpx.Client, base: str, key: str, user_id: str, role: str) -> None:
    r = client.post(
        f"{base}/rest/v1/role_assignments",
        params={"on_conflict": "user_id,institution_id,role"},
        headers={**_headers(key), "Prefer": "resolution=ignore-duplicates,return=minimal"},
        json={"user_id": user_id, "institution_id": INSTITUTION_ID, "role": role},
    )
    r.raise_for_status()


def main() -> int:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
        return 2
    with httpx.Client(timeout=30) as client:
        for email, name, role in DEMO_USERS:
            uid, created = ensure_user(client, base, key, email, name)
            print(f"{'created' if created else 'exists '} {email} ({uid})")
            if role:
                add_role(client, base, key, uid, role)
                print(f"         role {role}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
