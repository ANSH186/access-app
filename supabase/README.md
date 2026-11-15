# AccessAble AI - Supabase database

Postgres 15+, Supabase Auth, Realtime and Storage. Everything safety-related (SOS, reports, map edits) is done
with RLS plus `SECURITY DEFINER` RPC functions, so the app never depends on the FastAPI server for emergencies.

## Applying to a real Supabase project

Run the files in order, either way:

1. **SQL editor:** paste and run `migrations/0001_schema.sql`, then `0002_rls.sql`, `0003_functions.sql`, `0004_realtime_storage.sql`, then `seed.sql` (the map).
2. **CLI:** `supabase link --project-ref <ref>` then `supabase db push` (put `seed.sql` in `supabase/seed.sql`; it runs on `supabase db reset` locally, or paste it into the SQL editor for a hosted project).

Run each migration once. They are not written to be re-run (tables use plain `create table`).

After applying:
- Create users (Auth dashboard, or `services/api/scripts/seed_demo_users.py`). A `profiles` row is created automatically.
- Give staff roles from the SQL editor (there is no first admin otherwise):
  ```sql
  insert into role_assignments (user_id, institution_id, role)
  select id, '00000000-0000-0000-0000-000000000001', 'admin' from auth.users where email = 'admin@accessable.demo';
  ```
  Roles: `admin`, `responder`, `maintenance`, `map_editor`. Users with no row are ordinary students.
- The pilot institution has `test_mode_only = true`: every alert is forced to `is_test = true`. To allow live alerts:
  `update institutions set test_mode_only = false where id = '00000000-0000-0000-0000-000000000001';`
  Do this only after real response procedures exist.

## What each migration does

| File | Contents |
|---|---|
| `0001_schema.sql` | All tables, CHECKs, indexes (incl. one-active-alert-per-user unique index), `updated_at` triggers, `auth.users -> profiles` trigger, append-only triggers (`emergency_events`, `audit_events`, `report_events`), map audit triggers, report-insert sanitiser. Inserts the pilot institution. |
| `0002_rls.sql` | `has_role`, `my_institution` (+ map institution lookups), minimal grants (`anon` gets nothing), RLS enabled on every table, all policies. |
| `0003_functions.sql` | The RPC functions below. All `SECURITY DEFINER`, `search_path = public`, executable by `authenticated` only. |
| `0004_realtime_storage.sql` | Adds `emergency_alerts`, `emergency_events`, `obstacle_reports`, `route_edges` to `supabase_realtime`; `replica identity full` on alerts and reports; private bucket `report-photos` + policies. Guarded, so it is harmless on plain Postgres. |

Writes that clients can do directly: insert `obstacle_reports`, update own `profiles` preference columns, and (admin/map_editor) edit map tables and `role_assignments` (admin). Everything else goes through RPC.

## RPC cheat-sheet (supabase-js)

```ts
// Emergency - never touches FastAPI
const { data: alert, error } = await supabase.rpc('create_emergency', {
  p_client_request_id: crypto.randomUUID(),   // reuse the SAME id when retrying
  p_emergency_type: 'medical',                // unspecified|medical|lost|fall|unsafe|other
  p_message: 'I fell near the lift',
  p_node_id: nodeId,                          // last confirmed checkpoint, or omit
  p_location_source: 'qr_checkpoint',         // qr_checkpoint|staff_confirmed|route_progress|gps|unknown
  p_location_label: 'Floor 2, near lift (QR)',
  p_location_observed_at: scannedAtIso,       // when it was confirmed, NOT now
  p_is_test: true,
});
await supabase.rpc('cancel_emergency', { p_alert_id: id, p_reason: 'Pressed by mistake' });

await supabase.rpc('emergency_acknowledge', { p_alert_id: id });
await supabase.rpc('emergency_assign', { p_alert_id: id, p_responder_id: userId });
await supabase.rpc('emergency_set_status', { p_alert_id: id, p_status: 'responding' });   // responding|unable_to_contact|resolved
await supabase.rpc('emergency_set_status', { p_alert_id: id, p_status: 'resolved', p_note: 'Student reached help desk' }); // note required
await supabase.rpc('emergency_add_note', { p_alert_id: id, p_note: 'Called contact', p_visible_to_user: false });

// Reports
await supabase.from('obstacle_reports').insert({ category: 'blocked_path', edge_id, description, photo_path }); // status/reporter forced by trigger
await supabase.rpc('report_transition', { p_report_id: id, p_to_status: 'verified', p_note: 'Seen on site', p_block_edge: true });
await supabase.rpc('report_transition', { p_report_id: id, p_to_status: 'assigned', p_assignee_id: userId });
await supabase.rpc('report_transition', { p_report_id: id, p_to_status: 'resolved', p_note: 'Cleared' }); // reopens any edge it blocked

// Map
await supabase.rpc('set_edge_status', { p_edge_id: id, p_status: 'blocked', p_reason: 'Wet paint' });
const { data: cp } = await supabase.rpc('resolve_checkpoint', { p_qr_token: 'AA-CP-2-LIBRARY' }); // [] if unknown

// Realtime (dashboard)
supabase.channel('sos').on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_alerts' }, cb).subscribe();
```

Errors arrive as `error.message` in plain English and are safe to show or speak.

### Behaviour worth knowing
- `create_emergency` is idempotent on `(user, client_request_id)`; if the user already has an open alert it returns that one (and logs an internal `deduplicated` event) instead of refusing. If an open alert is a *test* alert and the new request is *live*, the old test alert is closed and the live one is created.
- Bad location input (unknown node, impossible coordinates, unknown type/source) is dropped or coerced rather than rejected - an SOS must never fail on data quality. `profiles.share_location_in_sos = false` stores no location at all.
- The free-text note on `emergency_set_status` is stored as an internal event (hidden from the student); the student sees the status change. `resolution_notes` on the alert row **is** readable by the alert owner.
- Staff photo access: storage SELECT for staff only works for photos referenced by a report's `photo_path`.

## Running the tests locally

Needs a Postgres reachable by `psql` (defaults: socket dir `/tmp`, port `54329`, user `postgres`; override with `PGHOST`, `PGPORT`, `PGUSER`).

```bash
supabase/tests/run_tests.sh
```

It recreates `aa_db_test`, loads `tests/00_supabase_stub.sql` (stub `auth`, `storage`, roles, publication), applies the real migrations in order, loads `tests/fixtures.sql`, and runs every `tests/test_*.sql` (plain SQL + `ASSERT`, each in a rolled-back transaction). If `supabase/seed.sql` exists it is loaded into a second fresh database to prove it matches the schema. Exit code is non-zero on any failure.
