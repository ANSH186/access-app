begin;
do $$
declare c record; n int;
begin
  -- resolve_checkpoint works for a plain student
  perform t.as_user(t.u(1));
  select * into c from resolve_checkpoint('TEST-QR');
  assert c.node_id = 'c0000000-0000-0000-0000-000000000003' and c.node_code = 'TB-C' and c.label = 'Corridor C'
     and c.floor_level = 0 and c.floor_name = 'Ground floor' and c.building_name = 'Test Block' and c.verified = false, 'checkpoint resolved';
  select count(*) into n from resolve_checkpoint('NOPE'); assert n = 0, 'unknown token returns nothing';
  select count(*) into n from resolve_checkpoint('  TEST-QR '); assert n = 1, 'token trimmed';
end $$;

do $$
declare e route_edges; n int; nn int;
begin
  perform t.as_postgres();
  select count(*) into n from resolve_checkpoint('TEST-QR'); assert n = 0, 'no uid, no result';

  -- set_edge_status permissions
  perform t.as_user(t.u(1));
  perform t.throws('select set_edge_status(''e0000000-0000-0000-0000-000000000001'', ''blocked'')', '%Only an admin or map editor%');
  perform t.as_user(t.u(5));
  perform t.throws('select set_edge_status(''e0000000-0000-0000-0000-000000000001'', ''blocked'')', '%Only an admin or map editor%');
  perform t.as_user(t.u(4));
  perform t.throws('select set_edge_status(''e0000000-0000-0000-0000-000000000001'', ''blocked'')', '%Only an admin or map editor%');
  perform t.as_user(t.u(6));
  perform t.throws('select set_edge_status(''e0000000-0000-0000-0000-000000000001'', ''weird'')', '%open or blocked%');
  perform t.throws('select set_edge_status(gen_random_uuid(), ''open'')', '%not found%');
  e := set_edge_status('e0000000-0000-0000-0000-000000000001', 'blocked', 'Wet paint');
  assert e.status = 'blocked' and e.blocked_reason = 'Wet paint';
  perform t.as_user(t.u(3));
  e := set_edge_status('e0000000-0000-0000-0000-000000000001', 'open');
  assert e.status = 'open' and e.blocked_reason is null and e.blocked_by_report_id is null;

  -- audit rows appear (actor recorded), only admin reads them
  perform t.as_user(t.u(3));
  select count(*) into n from audit_events where entity_type = 'route_edges' and actor_id in (t.u(3), t.u(6));
  assert n >= 2, 'edge audit rows: ' || n;
  perform t.as_user(t.u(6));
  select count(*) into n from audit_events; assert n = 0, 'map editor cannot read audit';
  perform t.as_user(t.u(1));
  select count(*) into n from audit_events; assert n = 0, 'student cannot read audit';
  perform t.throws('insert into audit_events (action) values (''x'')', '%permission denied%');

  -- direct map edits: map_editor yes (audited + updated_at bumped), maintenance/student no
  perform t.as_user(t.u(5));
  update route_nodes set label = 'Hacked' where code = 'TB-A'; get diagnostics n = row_count; assert n = 0, 'maintenance cannot edit nodes';
  perform t.as_user(t.u(1));
  update route_edges set status = 'blocked'; get diagnostics n = row_count; assert n = 0, 'student cannot edit edges';
  perform t.throws('insert into route_nodes (floor_id, code, kind, label, x, y) values (''f0000000-0000-0000-0000-000000000001'', ''Z'', ''room'', ''Z'', 0, 0)', '%row-level security%');
  perform t.as_user(t.u(6));
  update route_nodes set label = 'Corridor A (edited)', verified = true where code = 'TB-A';
  get diagnostics n = row_count; assert n = 1, 'map editor edits node';
  perform t.as_user(t.u(3));
  select count(*) into n from audit_events where entity_type = 'route_nodes' and action = 'route_nodes.update' and details ? 'label' and actor_id = t.u(6);
  assert n = 1, 'node edit audited';
  select count(*) into nn from audit_events where entity_type = 'route_nodes' and details::text like '%updated_at%'; -- updated_at is excluded from diffs
  assert nn = 0, 'updated_at not in diffs';
  perform t.as_user(t.u(6));
  insert into route_nodes (floor_id, code, kind, label, x, y) values ('f0000000-0000-0000-0000-000000000001', 'TB-D', 'room', 'Room D', 5, 5);
  delete from route_nodes where code = 'TB-D';
  perform t.as_user(t.u(3));
  select count(*) into n from audit_events where action in ('route_nodes.insert','route_nodes.delete');
  assert n = 2, 'insert+delete audited';
  perform t.as_postgres();
  assert (select updated_at from route_nodes where code = 'TB-A') > (select updated_at from route_nodes where code = 'TB-B'), 'updated_at bumped';
  -- seeding as postgres is not audited
  select count(*) into n from audit_events; 
  update route_nodes set notes = 'seed' where code = 'TB-B';
  assert (select count(*) from audit_events) = n, 'no-actor changes are not audited';

  -- role admin management
  perform t.as_user(t.u(3));
  insert into role_assignments (user_id, institution_id, role) values (t.u(2), '00000000-0000-0000-0000-000000000001', 'responder');
  perform t.as_user(t.u(2));
  assert has_role('00000000-0000-0000-0000-000000000001', array['responder']), 'new role effective';
  assert my_institution() = '00000000-0000-0000-0000-000000000001';
  select count(*) into n from role_assignments; assert n = 1, 'user sees only own roles';
  perform t.as_user(t.u(3));
  delete from role_assignments where user_id = t.u(2); get diagnostics n = row_count; assert n = 1;
  perform t.as_user(t.u(2));
  assert not has_role('00000000-0000-0000-0000-000000000001', array['responder']);
end $$;

-- the one-active-alert index and FK from edges to reports
do $$
begin
  perform t.as_postgres();
  perform t.throws('update route_edges set blocked_by_report_id = gen_random_uuid()', '%foreign key%');
end $$;
rollback;
