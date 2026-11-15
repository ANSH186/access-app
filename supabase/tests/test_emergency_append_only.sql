begin;
do $$
declare a emergency_alerts;
begin
  perform t.as_user(t.u(1)); select * into a from create_emergency('ao1');
  perform t.as_user(t.u(1));
  insert into obstacle_reports (category) values ('other');
  perform t.as_postgres();
  insert into report_events (report_id, actor_id, to_status) select id, t.u(5), 'x' from obstacle_reports limit 1;
  -- table owner / superuser: only the trigger stands in the way
  perform t.throws('update emergency_events set note = ''tampered''', '%append-only%');
  perform t.throws('delete from emergency_events', '%append-only%');
  perform t.throws('truncate emergency_events', '%append-only%');
  perform t.throws('update audit_events set action = ''x''', '%append-only%');
  perform t.throws('delete from audit_events', '%append-only%');
  perform t.throws('truncate audit_events', '%append-only%');
  assert (select count(*) from emergency_events) >= 1;
  -- report history too
  perform t.throws('update report_events set note = ''x''', '%append-only%');
  perform t.throws('delete from report_events', '%append-only%');
  -- evidence is not lost by deleting the user or the alert
  perform t.throws(format('delete from emergency_alerts where id = %L', a.id), '%foreign key%');
  perform t.throws(format('delete from auth.users where id = %L', t.u(1)), '%foreign key%');
end $$;
rollback;
