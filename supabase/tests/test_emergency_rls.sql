begin;
do $$
declare a1 emergency_alerts; a2 emergency_alerts; n int;
begin
  perform t.as_user(t.u(1)); select * into a1 from create_emergency('s1');
  perform t.as_user(t.u(2)); select * into a2 from create_emergency('s2');

  select count(*) into n from emergency_alerts; assert n = 1 and (select id from emergency_alerts) = a2.id, 'student 2 sees only own alert';
  select count(*) into n from emergency_alerts where id = a1.id; assert n = 0, 'cannot see other student alert';
  select count(*) into n from emergency_events where alert_id = a1.id; assert n = 0, 'cannot see other student events';

  -- direct writes are impossible
  perform t.throws(format('insert into emergency_alerts (user_id, institution_id, client_request_id) values (%L, %L, ''x'')', t.u(2), '00000000-0000-0000-0000-000000000001'), '%permission denied%');
  perform t.throws(format('update emergency_alerts set status = ''resolved'' where id = %L', a2.id), '%permission denied%');
  perform t.throws(format('delete from emergency_alerts where id = %L', a2.id), '%permission denied%');
  perform t.throws(format('insert into emergency_events (alert_id, event_type) values (%L, ''note'')', a2.id), '%permission denied%');
  perform t.throws(format('update emergency_events set note = ''x'' where alert_id = %L', a2.id), '%permission denied%');

  -- other users cannot cancel / see via rpc
  perform t.throws(format('select cancel_emergency(%L)', a1.id), '%not found%');
  perform t.throws(format('select emergency_acknowledge(%L)', a1.id), '%permission%');
  perform t.throws(format('select emergency_add_note(%L, ''hi'')', a1.id), '%permission%');

  -- responder & admin see all
  perform t.as_user(t.u(4)); select count(*) into n from emergency_alerts; assert n = 2, 'responder sees all';
  perform t.as_user(t.u(3)); select count(*) into n from emergency_alerts; assert n = 2, 'admin sees all';
  -- maintenance and map editor do not
  perform t.as_user(t.u(5)); select count(*) into n from emergency_alerts; assert n = 0, 'maintenance sees none';
  perform t.as_user(t.u(6)); select count(*) into n from emergency_alerts; assert n = 0, 'map editor sees none';
  select count(*) into n from emergency_events; assert n = 0, 'maintenance sees no events';
end $$;

-- anon sees nothing at all
do $$ begin
  perform t.as_postgres();
  execute 'set local role anon';
  perform t.throws('select * from emergency_alerts', '%permission denied%');
  perform t.throws('select * from route_nodes', '%permission denied%');
  perform t.throws('select * from profiles', '%permission denied%');
  perform t.as_postgres();
end $$;

-- hidden notes
do $$
declare a emergency_alerts; n int; ev emergency_events; a1id uuid;
begin
  select id into a1id from emergency_alerts where user_id = t.u(1) and status = 'triggered';
  perform t.as_user(t.u(1)); perform cancel_emergency(a1id); select * into a from create_emergency('h1');
  perform t.as_user(t.u(4));
  perform emergency_acknowledge(a.id);
  ev := emergency_add_note(a.id, 'internal: possibly drunk', false);
  assert not ev.visible_to_user and ev.event_type = 'note';
  ev := emergency_add_note(a.id, 'Walking to you now', true);
  assert ev.visible_to_user;
  perform t.throws(format('select emergency_add_note(%L, ''   '')', a.id), '%empty%');
  select count(*) into n from emergency_events where alert_id = a.id; assert n = 4, 'responder sees all events (triggered, ack, 2 notes)';

  perform t.as_user(t.u(1));
  select count(*) into n from emergency_events where alert_id = a.id and note like 'internal%'; assert n = 0, 'internal note hidden from student';
  select count(*) into n from emergency_events where alert_id = a.id and note = 'Walking to you now'; assert n = 1, 'shared note visible';
  select count(*) into n from emergency_events where alert_id = a.id; assert n = 3, 'student sees triggered, ack, shared note';
  perform t.throws(format('select emergency_add_note(%L, ''student note'')', a.id), '%permission%');
end $$;

-- profile privacy + escalation
do $$
declare n int;
begin
  perform t.as_user(t.u(2));
  select count(*) into n from profiles; assert n = 1, 'student sees only own profile';
  update profiles set speech_rate = 1.5, avoid_stairs = true where id = t.u(2);
  assert (select speech_rate from profiles where id = t.u(2)) = 1.5;
  perform t.throws(format('update profiles set institution_id = gen_random_uuid() where id = %L', t.u(2)), '%permission denied%');
  perform t.throws('update profiles set speech_rate = 99', '%violates check%');
  perform t.throws(format('insert into role_assignments (user_id, institution_id, role) values (%L, %L, ''admin'')', t.u(2), '00000000-0000-0000-0000-000000000001'), '%row-level security%');
  perform t.as_user(t.u(4)); select count(*) into n from profiles; assert n >= 7, 'responder can read profiles';
  update profiles set display_name = 'hax' where id = t.u(1);
  get diagnostics n = row_count;
  assert n = 0, 'responder cannot update another profile';
end $$;
rollback;
