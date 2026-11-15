begin;
do $$
declare n int;
begin
  select count(*) into n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('emergency_alerts','emergency_events','obstacle_reports','route_edges');
  assert n = 4, 'four tables in publication';
  assert (select relreplident from pg_class where oid = 'emergency_alerts'::regclass) = 'f';
  assert (select relreplident from pg_class where oid = 'obstacle_reports'::regclass) = 'f';
  assert exists (select 1 from storage.buckets where id = 'report-photos' and not public), 'private bucket';
  select count(*) into n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'report photos:%';
  assert n = 3, 'three storage policies';

  -- RLS enabled on every public table, nothing grantable to anon
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert n = 0, 'all public tables have RLS';
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';
  assert n = 0, 'anon has no table grants';
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and (has_function_privilege('anon', p.oid, 'execute'));
  assert n = 0, 'no app function is executable by anon/public: ' || n;
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('_log_audit','_emergency_event','_lock_alert_for_staff','handle_new_user','audit_map_change')
     and has_function_privilege('authenticated', p.oid, 'execute');
  assert n = 0, 'internal functions are not callable by clients';
end $$;

-- storage policies behave
insert into storage.objects (bucket_id, name) values ('report-photos', 'a0000000-0000-0000-0000-000000000002/img.jpg');
do $$
declare n int;
begin
  perform t.as_user(t.u(1));
  insert into storage.objects (bucket_id, name) values ('report-photos', t.u(1)::text || '/11111111-1111-1111-1111-111111111111.jpg');
  perform t.throws(format('insert into storage.objects (bucket_id, name) values (''report-photos'', ''%s/x.jpg'')', t.u(2)), '%row-level security%');
  perform t.throws(format('insert into storage.objects (bucket_id, name) values (''report-photos'', ''%s/x.png'')', t.u(1)), '%row-level security%');
  select count(*) into n from storage.objects; assert n = 1, 'owner reads only own photo';
  perform t.throws(format('insert into obstacle_reports (category, photo_path) values (''other'', ''%s/img.jpg'')', t.u(2)), '%does not belong%');
end $$;
do $$
declare n int;
begin
  perform t.as_user(t.u(1));
  insert into obstacle_reports (category, photo_path) values ('other', t.u(1)::text || '/11111111-1111-1111-1111-111111111111.jpg');
  perform t.as_user(t.u(5));
  select count(*) into n from storage.objects; assert n = 1, 'maintenance reads the attached photo only';
  perform t.as_user(t.u(2));
  select count(*) into n from storage.objects; assert n = 1, 'student 2 only sees own';
end $$;
rollback;
