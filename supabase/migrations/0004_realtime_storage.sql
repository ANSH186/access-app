-- AccessAble AI - 0004 realtime publication + photo storage
-- Everything is guarded so it is harmless on plain Postgres.

-- Realtime: live updates for the dashboard and the app.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    foreach t in array array['emergency_alerts','emergency_events','obstacle_reports','route_edges'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Full old-row images so realtime UPDATE events carry every column.
alter table public.emergency_alerts replica identity full;
alter table public.obstacle_reports replica identity full;

-- Storage: private bucket for report photos.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and to_regclass('storage.buckets') is not null
     and to_regclass('storage.objects') is not null then

    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('report-photos', 'report-photos', false, 5242880, array['image/jpeg'])
    on conflict (id) do update
      set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

    drop policy if exists "report photos: owner uploads" on storage.objects;
    drop policy if exists "report photos: owner reads"   on storage.objects;
    drop policy if exists "report photos: staff read"    on storage.objects;

    -- Upload to <auth.uid()>/<uuid>.jpg only.
    create policy "report photos: owner uploads" on storage.objects for insert to authenticated
      with check (bucket_id = 'report-photos'
                  and (storage.foldername(name))[1] = auth.uid()::text
                  and lower(name) ~ '\.jpe?g$');

    create policy "report photos: owner reads" on storage.objects for select to authenticated
      using (bucket_id = 'report-photos' and (storage.foldername(name))[1] = auth.uid()::text);

    -- Staff read photos attached to reports of their institution.
    create policy "report photos: staff read" on storage.objects for select to authenticated
      using (bucket_id = 'report-photos'
             and exists (select 1 from public.obstacle_reports r
                          where r.photo_path = storage.objects.name
                            and public.has_role(r.institution_id, array['admin','maintenance','map_editor'])));
  end if;
end $$;
