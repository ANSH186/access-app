begin;
do $$
declare r obstacle_reports; r2 obstacle_reports; e route_edges; n int; rid uuid;
begin
  -- insert sanitising: client tries to forge everything
  perform t.as_user(t.u(1));
  insert into obstacle_reports (reporter_id, institution_id, edge_id, category, description, status, assignee_id, verified_by, verified_at, resolution_notes)
  values (t.u(2), gen_random_uuid(), 'e0000000-0000-0000-0000-000000000002', 'blocked_path', 'Boxes in corridor', 'resolved', t.u(5), t.u(5), now(), 'forged')
  returning * into r;
  assert r.status = 'submitted', 'status forced';
  assert r.reporter_id = t.u(1), 'reporter forced';
  assert r.institution_id = '00000000-0000-0000-0000-000000000001', 'institution from profile';
  assert r.assignee_id is null and r.verified_by is null and r.verified_at is null and r.resolution_notes is null, 'staff fields cleared';

  -- plain insert with no reporter works too
  insert into obstacle_reports (category, node_id) values ('wet_floor', 'c0000000-0000-0000-0000-000000000001') returning * into r2;
  assert r2.reporter_id = t.u(1);
  -- bad category / foreign photo / foreign node
  perform t.throws('insert into obstacle_reports (category) values (''nope'')', '%violates check%');
  perform t.throws(format('insert into obstacle_reports (category, photo_path) values (''other'', ''%s/x.jpg'')', t.u(2)), '%photo does not belong%');
  insert into obstacle_reports (category, photo_path) values ('other', t.u(1)::text || '/abc.jpg');

  -- student cannot update or delete, and cannot see others' reports
  perform t.throws(format('update obstacle_reports set status = ''verified'' where id = %L', r.id), '%permission denied%');
  perform t.throws(format('delete from obstacle_reports where id = %L', r.id), '%permission denied%');
  perform t.throws(format('insert into report_events (report_id) values (%L)', r.id), '%permission denied%');
  select count(*) into n from obstacle_reports; assert n = 3, 'owner sees own 3';
  perform t.as_user(t.u(2));
  select count(*) into n from obstacle_reports; assert n = 0, 'other student sees none';
  perform t.throws(format('select report_transition(%L, ''verified'')', r.id), '%Only maintenance%');

  -- maintenance: can see, transition, but cannot block edges
  perform t.as_user(t.u(5));
  select count(*) into n from obstacle_reports; assert n = 3, 'maintenance sees all';
  perform t.throws(format('select report_transition(%L, ''closed'')', r.id), '%cannot be changed%');
  perform t.throws(format('select report_transition(%L, ''bogus'')', r.id), '%cannot be changed%');
  perform t.throws(format('select report_transition(%L, ''under_review'', null, true)', r.id), '%only be blocked when%');
  perform t.throws(format('select report_transition(%L, ''verified'', null, true)', r.id), '%admin or map editor can block%');
  assert (select status from obstacle_reports where id = r.id) = 'submitted', 'failed transition changed nothing';
  assert (select status from route_edges where id = 'e0000000-0000-0000-0000-000000000002') = 'open';
  r := report_transition(r.id, 'under_review', 'Looking into it');
  assert r.status = 'under_review';
  r := report_transition(r.id, 'verified', 'Confirmed on site');   -- without blocking
  assert r.status = 'verified' and r.verified_by = t.u(5) and r.verified_at is not null;
  assert (select status from route_edges where id = 'e0000000-0000-0000-0000-000000000002') = 'open', 'no block without p_block_edge';
  perform t.throws(format('select report_transition(%L, ''assigned'')', r.id), '%who the report is assigned to%');
  perform t.throws(format('select report_transition(%L, ''assigned'', null, false, %L)', r.id, t.u(1)), '%not on the maintenance%');
  r := report_transition(r.id, 'assigned', null, false, t.u(5));
  assert r.assignee_id = t.u(5);
  r := report_transition(r.id, 'resolved', 'Boxes removed');
  assert r.resolution_notes = 'Boxes removed';

  -- reporter can see history of own report
  perform t.as_user(t.u(1));
  select count(*) into n from report_events where report_id = r.id; assert n = 4, 'reporter sees 4 events: ' || n;
  perform t.as_user(t.u(2));
  select count(*) into n from report_events; assert n = 0;
  perform t.as_postgres();
  assert exists (select 1 from audit_events where action = 'report.transition' and entity_id = r.id::text), 'report audit';

  -- admin: verified + block edge, then resolve reopens it
  perform t.as_user(t.u(1));
  insert into obstacle_reports (category, description, edge_id) values ('construction', 'Floor work', 'e0000000-0000-0000-0000-000000000001') returning id into rid;
  perform t.as_user(t.u(3));
  perform report_transition(rid, 'verified', 'ok', true);
  select * into e from route_edges where id = 'e0000000-0000-0000-0000-000000000001';
  assert e.status = 'blocked' and e.blocked_by_report_id = rid and e.blocked_reason = 'construction: Floor work', 'edge blocked: ' || coalesce(e.blocked_reason,'?');
  perform t.as_postgres();
  assert exists (select 1 from audit_events where entity_type = 'route_edges' and entity_id = 'e0000000-0000-0000-0000-000000000001' and details ? 'status'), 'edge change audited';
  perform t.as_user(t.u(6));
  perform report_transition(rid, 'resolved', 'Done');
  select * into e from route_edges where id = 'e0000000-0000-0000-0000-000000000001';
  assert e.status = 'open' and e.blocked_by_report_id is null and e.blocked_reason is null, 'edge reopened on resolve';
  perform report_transition(rid, 'reopened', 'Came back');
  perform report_transition(rid, 'verified', null, true);
  assert (select status from route_edges where id = 'e0000000-0000-0000-0000-000000000001') = 'blocked', 'reopened->verified can block again';
  perform t.throws(format('select report_transition(%L, ''resolved'', null, true)', rid), '%only be blocked%');
  -- blocking a report without an edge
  perform t.as_user(t.u(1));
  insert into obstacle_reports (category) values ('other') returning id into rid;
  perform t.as_user(t.u(3));
  perform t.throws(format('select report_transition(%L, ''verified'', null, true)', rid), '%Choose which path%');
  -- node-only report (what the phone app sends): staff pick the path with p_edge_id
  perform t.as_user(t.u(1));
  insert into obstacle_reports (category, description, node_id) values ('blocked_path', 'Chairs', 'c0000000-0000-0000-0000-000000000002') returning id into rid;
  perform t.as_user(t.u(3));
  r := report_transition(rid, 'verified', 'seen on CCTV', true, null, 'e0000000-0000-0000-0000-000000000002');
  assert r.edge_id = 'e0000000-0000-0000-0000-000000000002', 'chosen edge stored on report';
  assert (select status from route_edges where id = 'e0000000-0000-0000-0000-000000000002') = 'blocked', 'chosen edge blocked';
  perform report_transition(rid, 'resolved', 'cleared');
  assert (select status from route_edges where id = 'e0000000-0000-0000-0000-000000000002') = 'open', 'chosen edge reopened';
  perform t.as_user(t.u(1));
  insert into obstacle_reports (category) values ('other') returning id into rid;
  perform t.as_user(t.u(3));
  perform t.throws('select report_transition(gen_random_uuid(), ''verified'')', '%not found%');
  -- rejected can be reopened; invalid jump refused
  perform report_transition(rid, 'rejected');
  perform t.throws(format('select report_transition(%L, ''verified'')', rid), '%cannot be changed%');
  perform report_transition(rid, 'reopened');
end $$;
rollback;
