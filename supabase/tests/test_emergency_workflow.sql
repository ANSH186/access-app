begin;
do $$
declare a emergency_alerts; x emergency_alerts; n int;
begin
  perform t.as_user(t.u(1)); select * into a from create_emergency('w1', 'medical');

  -- people without emergency roles cannot act
  perform t.as_user(t.u(5));
  perform t.throws(format('select emergency_acknowledge(%L)', a.id), '%permission%');
  perform t.throws(format('select emergency_assign(%L, %L)', a.id, t.u(4)), '%permission%');
  perform t.throws(format('select emergency_set_status(%L, ''responding'')', a.id), '%permission%');
  perform t.as_user(t.u(6));
  perform t.throws(format('select emergency_acknowledge(%L)', a.id), '%permission%');
  perform t.as_user(t.u(2));
  perform t.throws(format('select emergency_acknowledge(%L)', a.id), '%permission%');
  perform t.as_user(t.u(1));
  perform t.throws(format('select emergency_acknowledge(%L)', a.id), '%permission%');

  -- cannot change status before acknowledging
  perform t.as_user(t.u(4));
  perform t.throws(format('select emergency_set_status(%L, ''responding'')', a.id), '%Acknowledge this emergency%');
  perform t.throws(format('select emergency_set_status(%L, ''resolved'', ''x'')', a.id), '%Acknowledge this emergency%');

  -- acknowledge
  x := emergency_acknowledge(a.id);
  assert x.status = 'acknowledged' and x.acknowledged_by = t.u(4) and x.acknowledged_at is not null;
  perform t.throws(format('select emergency_acknowledge(%L)', a.id), '%already been acknowledged%');
  perform t.as_user(t.u(7));
  perform t.throws(format('select emergency_acknowledge(%L)', a.id), '%already been acknowledged%');

  -- assign: target must be responder/admin
  perform t.as_user(t.u(4));
  perform t.throws(format('select emergency_assign(%L, %L)', a.id, t.u(5)), '%not a responder%');
  perform t.throws(format('select emergency_assign(%L, %L)', a.id, t.u(1)), '%not a responder%');
  perform t.throws(format('select emergency_assign(%L, null)', a.id), '%not a responder%');
  x := emergency_assign(a.id, t.u(7));
  assert x.assigned_responder_id = t.u(7) and x.status = 'acknowledged';

  -- set status
  perform t.throws(format('select emergency_set_status(%L, ''triggered'')', a.id), '%cannot be set here%');
  perform t.throws(format('select emergency_set_status(%L, ''cancelled'')', a.id), '%cannot be set here%');
  perform t.throws(format('select emergency_set_status(%L, ''bogus'')', a.id), '%cannot be set here%');
  x := emergency_set_status(a.id, 'responding', 'On my way, internal detail');
  assert x.status = 'responding';
  perform t.throws(format('select emergency_set_status(%L, ''responding'')', a.id), '%already marked%');
  x := emergency_set_status(a.id, 'unable_to_contact');
  assert x.status = 'unable_to_contact';
  x := emergency_set_status(a.id, 'responding');
  assert x.status = 'responding';

  -- resolve needs a note
  perform t.throws(format('select emergency_set_status(%L, ''resolved'')', a.id), '%note%');
  perform t.throws(format('select emergency_set_status(%L, ''resolved'', ''   '')', a.id), '%note%');
  assert (select status from emergency_alerts where id = a.id) = 'responding', 'failed resolve changed nothing';
  x := emergency_set_status(a.id, 'resolved', 'Student was helped to the help desk.');
  assert x.status = 'resolved' and x.resolved_at is not null and x.resolution_notes = 'Student was helped to the help desk.';

  -- closed alerts accept nothing
  perform t.throws(format('select emergency_set_status(%L, ''responding'')', a.id), '%already closed%');
  perform t.throws(format('select emergency_acknowledge(%L)', a.id), '%already closed%');
  perform t.throws(format('select emergency_assign(%L, %L)', a.id, t.u(7)), '%already closed%');

  -- the status note stayed internal; the student sees status changes only
  perform t.as_user(t.u(1));
  select count(*) into n from emergency_events where note like '%internal detail%'; assert n = 0, 'status note hidden from student';
  select count(*) into n from emergency_events where event_type = 'status_changed'; assert n = 4, 'student sees 4 status changes (responding, unable, responding, resolved)';
  perform t.throws(format('select cancel_emergency(%L)', a.id), '%already closed%');

  -- timeline for staff
  perform t.as_user(t.u(3));
  select count(*) into n from emergency_events where alert_id = a.id and note like '%internal detail%' and not visible_to_user; assert n = 1;
  select count(*) into n from audit_events where entity_id = a.id::text and action like 'emergency.%'; assert n >= 7, 'audit trail written';
end $$;

-- assign from triggered also acknowledges
do $$
declare a emergency_alerts; x emergency_alerts; n int;
begin
  perform t.as_user(t.u(2)); select * into a from create_emergency('w2');
  perform t.as_user(t.u(3));
  x := emergency_assign(a.id, t.u(4));
  assert x.status = 'acknowledged' and x.acknowledged_by = t.u(3) and x.acknowledged_at is not null and x.assigned_responder_id = t.u(4);
  select count(*) into n from emergency_events where alert_id = a.id and event_type in ('acknowledged','assigned'); assert n = 2;
  -- admin can resolve directly from acknowledged
  x := emergency_set_status(a.id, 'resolved', 'False alarm confirmed by phone.');
  assert x.status = 'resolved';
end $$;

-- cancel: owner only, active only
do $$
declare a emergency_alerts; x emergency_alerts; n int;
begin
  perform t.as_user(t.u(2)); select * into a from create_emergency('c1');
  perform t.as_user(t.u(1));
  perform t.throws(format('select cancel_emergency(%L)', a.id), '%not found%');
  perform t.as_user(t.u(4));
  perform t.throws(format('select cancel_emergency(%L)', a.id), '%not found%');
  perform t.as_user(t.u(2));
  x := cancel_emergency(a.id, 'Pressed by mistake');
  assert x.status = 'cancelled';
  perform t.throws(format('select cancel_emergency(%L)', a.id), '%already closed%');
  perform t.throws(format('select emergency_acknowledge(%L)', a.id), '%permission%');
  perform t.as_user(t.u(4));
  perform t.throws(format('select emergency_acknowledge(%L)', a.id), '%already closed%');
  select count(*) into n from emergency_events where alert_id = a.id and event_type = 'cancelled' and note = 'Pressed by mistake'; assert n = 1;
  -- after cancelling, the user can raise a new alert
  perform t.as_user(t.u(2));
  x := create_emergency('c2');
  assert x.id <> a.id and x.status = 'triggered';
  -- cancel after acknowledgement is allowed
  perform t.as_user(t.u(4)); perform emergency_acknowledge(x.id);
  perform t.as_user(t.u(2)); x := cancel_emergency(x.id);
  assert x.status = 'cancelled';
  perform t.throws('select cancel_emergency(gen_random_uuid())', '%not found%');
end $$;
rollback;
