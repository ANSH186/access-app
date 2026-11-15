begin;
do $$
declare a emergency_alerts; b emergency_alerts; c emergency_alerts; n int; ev int;
begin
  -- profile trigger
  assert (select display_name from profiles where id = t.u(1)) = 'Test Student', 'display_name from metadata';
  assert (select display_name from profiles where id = t.u(2)) = 'student2', 'display_name falls back to email prefix';

  perform t.as_user(t.u(1));
  -- happy path
  select * into a from create_emergency('req-1', 'medical', 'I fell', 'c0000000-0000-0000-0000-000000000002',
        'qr_checkpoint', 'Ground floor, near B', now() - interval '2 minutes', null, null, null, true);
  assert a.status = 'triggered', 'status triggered';
  assert a.user_id = t.u(1) and a.institution_id = '00000000-0000-0000-0000-000000000001';
  assert a.emergency_type = 'medical' and a.message = 'I fell';
  assert a.node_id = 'c0000000-0000-0000-0000-000000000002', 'node kept';
  assert a.location_source = 'qr_checkpoint' and a.location_label = 'Ground floor, near B';
  assert a.location_observed_at < now() - interval '1 minute', 'observed_at is the supplied time, not now()';
  assert a.acknowledged_at is null and a.acknowledged_by is null and a.resolved_at is null and a.assigned_responder_id is null;
  assert a.is_test, 'is_test true';

  -- idempotency: same request id returns same row, no new events
  select * into b from create_emergency('req-1', 'fall', 'different');
  assert b.id = a.id and b.emergency_type = 'medical', 'idempotent returns existing row unchanged';
  select count(*) into n from emergency_alerts where user_id = t.u(1);
  assert n = 1, 'only one alert';

  -- dedupe: new request id while active returns the active alert
  select * into c from create_emergency('req-2', 'lost', 'again');
  assert c.id = a.id, 'dedupe returns active alert';
  perform t.as_postgres();
  select count(*) into n from emergency_alerts where user_id = t.u(1);
  assert n = 1, 'still one alert after dedupe';
  select count(*) into ev from emergency_events where alert_id = a.id and event_type = 'deduplicated';
  assert ev = 1, 'deduplicated event logged';
  select count(*) into ev from emergency_events where alert_id = a.id and event_type = 'triggered';
  assert ev = 1, 'one triggered event';
  assert exists (select 1 from audit_events where action = 'emergency.triggered' and entity_id = a.id::text), 'audit row';

  -- unauthenticated / bad input
  perform t.as_postgres();
  perform t.throws('select create_emergency(''x'')', '%signed in%');
  perform t.as_user(t.u(2));
  perform t.throws('select create_emergency('''')', '%request id%');
  perform t.throws('select create_emergency(null)', '%request id%');
end $$;

-- anon cannot call it
do $$ begin
  perform t.as_postgres();
  execute 'set local role anon';
  perform t.throws('select create_emergency(''x'')', '%permission denied%');
  perform t.as_postgres();
end $$;

-- test_mode_only forces is_test; honoured once institution allows live alerts
do $$
declare a emergency_alerts;
begin
  perform t.as_user(t.u(2));
  select * into a from create_emergency('live-try', 'unspecified', null, null, 'unknown', null, null, null, null, null, false);
  assert a.is_test, 'test_mode_only forces is_test=true even if client says false';
  perform cancel_emergency(a.id);
  perform t.as_postgres();
  update institutions set test_mode_only = false where id = '00000000-0000-0000-0000-000000000001';
  perform t.as_user(t.u(2));
  select * into a from create_emergency('live-ok', 'unspecified', null, null, 'unknown', null, null, null, null, null, false);
  assert not a.is_test, 'live alert allowed when institution is out of test mode';
  perform cancel_emergency(a.id);
  select * into a from create_emergency('default-test');
  assert a.is_test, 'default p_is_test is true';
  perform cancel_emergency(a.id);
  perform t.as_postgres();
  update institutions set test_mode_only = true where id = '00000000-0000-0000-0000-000000000001';
end $$;

-- a real alert is not swallowed by a lingering test alert
do $$
declare a emergency_alerts; b emergency_alerts;
begin
  update institutions set test_mode_only = false;
  perform t.as_user(t.u(2));
  select * into a from create_emergency('t1', 'unspecified', null, null, 'unknown', null, null, null, null, null, true);
  select * into b from create_emergency('r1', 'medical', null, null, 'unknown', null, null, null, null, null, false);
  assert b.id <> a.id and not b.is_test, 'real alert created alongside old test alert';
  assert (select status from emergency_alerts where id = a.id) = 'cancelled', 'old test alert closed';
  perform t.as_postgres();
  update institutions set test_mode_only = true;
end $$;

-- location handling
do $$
declare a emergency_alerts;
begin
  -- share_location_in_sos = false stores no location at all
  perform t.as_postgres();
  update profiles set share_location_in_sos = false where id = t.u(1);
  perform t.as_user(t.u(1));
  -- first close student 1's earlier active alert
  perform cancel_emergency((select id from emergency_alerts where user_id = t.u(1) and status = 'triggered'));
  select * into a from create_emergency('noloc', 'unsafe', 'help', 'c0000000-0000-0000-0000-000000000002',
        'gps', 'somewhere', now(), 12.97, 77.59, 5);
  assert a.node_id is null and a.lat is null and a.lng is null and a.accuracy_m is null, 'no location stored';
  assert a.location_source = 'unknown' and a.location_label is null and a.location_observed_at is null;
  assert a.message = 'help', 'message still stored';
  perform cancel_emergency(a.id);

  perform t.as_postgres();
  update profiles set share_location_in_sos = true where id = t.u(1);
  perform t.as_user(t.u(1));
  select * into a from create_emergency('gps', 'other', null, null, 'gps', null, null, 12.97, 77.59, 8.5);
  assert a.lat = 12.97 and a.lng = 77.59 and a.accuracy_m = 8.5 and a.location_source = 'gps';
  assert a.location_observed_at is null, 'observed_at not fabricated';
  perform cancel_emergency(a.id);

  -- garbage location never blocks the alert
  select * into a from create_emergency('junk', 'bogus_type', null, gen_random_uuid(), 'teleport', null, now() + interval '1 day', 999, 999, -4, true);
  assert a.status = 'triggered' and a.emergency_type = 'unspecified', 'bad type coerced';
  assert a.node_id is null and a.lat is null and a.location_source = 'unknown' and a.location_observed_at is null, 'junk location dropped';
  perform cancel_emergency(a.id);

  -- future observed time is clamped
  select * into a from create_emergency('fut', 'other', null, 'c0000000-0000-0000-0000-000000000003', 'qr_checkpoint', null, now() + interval '1 day');
  assert a.location_observed_at <= now(), 'observed_at clamped';
end $$;
rollback;
