-- AccessAble AI - 0001 schema
-- Tables, constraints, indexes, updated_at triggers, auth.users -> profiles trigger,
-- append-only triggers, audit triggers for the map, and the report-insert sanitiser.
-- Postgres 15+. Safe to run once on a fresh Supabase project.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.institutions (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  address         text,
  test_mode_only  boolean not null default true,
  created_at      timestamptz not null default now()
);

-- The pilot institution (CONTRACT section 1). Fixed id so other parts can rely on it.
insert into public.institutions (id, name, test_mode_only)
values ('00000000-0000-0000-0000-000000000001', 'NIE Mysore (pilot)', true)
on conflict (id) do nothing;

create table public.profiles (
  id                       uuid primary key references auth.users (id) on delete cascade,
  institution_id           uuid not null references public.institutions (id)
                             default '00000000-0000-0000-0000-000000000001',
  display_name             text,
  phone                    text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  share_location_in_sos    boolean not null default true,
  speech_rate              real not null default 1.0 check (speech_rate between 0.25 and 3.0),
  avoid_stairs             boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table public.role_assignments (
  user_id         uuid not null references auth.users (id) on delete cascade,
  institution_id  uuid not null references public.institutions (id),
  role            text not null check (role in ('admin','responder','maintenance','map_editor')),
  created_at      timestamptz not null default now(),
  primary key (user_id, institution_id, role)
);

create table public.buildings (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions (id),
  code            text not null unique,
  name            text not null,
  lat             double precision,
  lng             double precision,
  is_placeholder  boolean not null default true,
  notes           text
);

create table public.floors (
  id           uuid primary key default gen_random_uuid(),
  building_id  uuid not null references public.buildings (id) on delete cascade,
  code         text not null unique,
  level        int  not null,
  name         text not null
);

create table public.route_nodes (
  id           uuid primary key default gen_random_uuid(),
  floor_id     uuid not null references public.floors (id) on delete cascade,
  code         text not null unique,
  kind         text not null check (kind in ('corridor','entrance','room','lab','office','library',
                                             'washroom','help_desk','stairs','lift','emergency_point')),
  label        text not null,
  aliases      text[] not null default '{}',
  x            double precision not null,
  y            double precision not null,
  searchable   boolean not null default false,
  qr_token     text unique,
  verified     boolean not null default false,
  verified_at  timestamptz,
  notes        text,
  updated_at   timestamptz not null default now()
);

create table public.route_edges (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  from_node_id        uuid not null references public.route_nodes (id) on delete cascade,
  to_node_id          uuid not null references public.route_nodes (id) on delete cascade,
  kind                text not null check (kind in ('corridor','door','stairs','lift','outdoor')),
  length_m            double precision not null check (length_m > 0),
  step_free           boolean not null,
  status              text not null default 'open' check (status in ('open','blocked')),
  blocked_reason      text,
  blocked_by_report_id uuid,  -- FK added below, after obstacle_reports exists
  verified            boolean not null default false,
  verified_at         timestamptz,
  updated_at          timestamptz not null default now(),
  check (from_node_id <> to_node_id)
);

create table public.obstacle_reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid references auth.users (id) on delete set null,
  institution_id  uuid not null references public.institutions (id)
                    default '00000000-0000-0000-0000-000000000001',
  node_id         uuid references public.route_nodes (id) on delete set null,
  edge_id         uuid references public.route_edges (id) on delete set null,
  category        text not null check (category in ('blocked_path','closed_door','broken_lift','wet_floor',
                                                    'missing_sign','construction','other')),
  description     text check (char_length(description) <= 2000),
  photo_path      text,   -- path inside storage bucket 'report-photos'
  status          text not null default 'submitted' check (status in
                    ('submitted','under_review','verified','assigned','resolved','closed','rejected','reopened')),
  assignee_id     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  verified_by     uuid,
  verified_at     timestamptz,
  resolution_notes text
);

alter table public.route_edges
  add constraint route_edges_blocked_by_report_fk
  foreign key (blocked_by_report_id) references public.obstacle_reports (id) on delete set null;

create table public.report_events (
  id          bigserial primary key,
  report_id   uuid not null references public.obstacle_reports (id),
  actor_id    uuid,
  from_status text,
  to_status   text,
  note        text,
  created_at  timestamptz not null default now()
);

create table public.emergency_alerts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id),   -- no cascade: evidence is kept
  institution_id        uuid not null references public.institutions (id),
  client_request_id     text not null,
  emergency_type        text not null default 'unspecified' check (emergency_type in
                          ('unspecified','medical','lost','fall','unsafe','other')),
  message               text,
  is_test               boolean not null default true,
  status                text not null default 'triggered' check (status in
                          ('triggered','acknowledged','responding','unable_to_contact','resolved','cancelled')),
  node_id               uuid references public.route_nodes (id) on delete set null,
  location_source       text not null default 'unknown' check (location_source in
                          ('qr_checkpoint','staff_confirmed','route_progress','gps','unknown')),
  location_label        text,
  location_observed_at  timestamptz,
  lat                   double precision,
  lng                   double precision,
  accuracy_m            double precision,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  acknowledged_at       timestamptz,
  acknowledged_by       uuid,
  assigned_responder_id uuid,
  resolved_at           timestamptz,
  resolution_notes      text,
  unique (user_id, client_request_id)
);

create table public.emergency_events (
  id               bigserial primary key,
  alert_id         uuid not null references public.emergency_alerts (id),
  actor_id         uuid,
  event_type       text not null check (event_type in
                     ('triggered','acknowledged','assigned','status_changed','note','cancelled','deduplicated')),
  from_status      text,
  to_status        text,
  note             text,
  visible_to_user  boolean not null default true,
  created_at       timestamptz not null default now()
);

create table public.audit_events (
  id              bigserial primary key,
  actor_id        uuid,
  institution_id  uuid,
  action          text not null,
  entity_type     text,
  entity_id       text,
  details         jsonb,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index profiles_institution_idx          on public.profiles (institution_id);
create index role_assignments_institution_idx  on public.role_assignments (institution_id);
create index buildings_institution_idx         on public.buildings (institution_id);
create index floors_building_idx               on public.floors (building_id);
create index route_nodes_floor_idx             on public.route_nodes (floor_id);
create index route_nodes_searchable_idx        on public.route_nodes (searchable) where searchable;
create index route_edges_from_idx              on public.route_edges (from_node_id);
create index route_edges_to_idx                on public.route_edges (to_node_id);
create index route_edges_status_idx            on public.route_edges (status);
create index route_edges_blocked_by_idx        on public.route_edges (blocked_by_report_id);
create index obstacle_reports_reporter_idx     on public.obstacle_reports (reporter_id);
create index obstacle_reports_institution_idx  on public.obstacle_reports (institution_id, status, created_at desc);
create index obstacle_reports_node_idx         on public.obstacle_reports (node_id);
create index obstacle_reports_edge_idx         on public.obstacle_reports (edge_id);
create index obstacle_reports_status_idx       on public.obstacle_reports (status);
create index obstacle_reports_assignee_idx     on public.obstacle_reports (assignee_id);
create index report_events_report_idx          on public.report_events (report_id, created_at);
create index emergency_alerts_user_idx         on public.emergency_alerts (user_id);
create index emergency_alerts_node_idx         on public.emergency_alerts (node_id);
create index emergency_alerts_status_idx       on public.emergency_alerts (status);
create index emergency_alerts_assigned_idx     on public.emergency_alerts (assigned_responder_id);
create index emergency_alerts_queue_idx        on public.emergency_alerts (institution_id, status, created_at);
-- Database-level guarantee: at most one active alert per user (the RPC dedupes first).
create unique index emergency_alerts_one_active_per_user
  on public.emergency_alerts (user_id)
  where status in ('triggered','acknowledged','responding','unable_to_contact');
create index emergency_events_alert_idx        on public.emergency_events (alert_id, created_at);
create index audit_events_institution_idx      on public.audit_events (institution_id, created_at desc);
create index audit_events_entity_idx           on public.audit_events (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_set_updated_at          before update on public.profiles          for each row execute function public.set_updated_at();
create trigger route_nodes_set_updated_at       before update on public.route_nodes       for each row execute function public.set_updated_at();
create trigger route_edges_set_updated_at       before update on public.route_edges       for each row execute function public.set_updated_at();
create trigger obstacle_reports_set_updated_at  before update on public.obstacle_reports  for each row execute function public.set_updated_at();
create trigger emergency_alerts_set_updated_at  before update on public.emergency_alerts  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- auth.users -> profiles
-- ---------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''))
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for users that already exist when this migration is applied.
insert into public.profiles (id, display_name)
select u.id, coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''))
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Append-only tables
-- ---------------------------------------------------------------------------

create function public.reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'This record is append-only and cannot be changed or deleted (%).', tg_table_name;
end $$;

create trigger emergency_events_append_only before update or delete on public.emergency_events
  for each row execute function public.reject_mutation();
create trigger emergency_events_no_truncate before truncate on public.emergency_events
  for each statement execute function public.reject_mutation();

create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function public.reject_mutation();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function public.reject_mutation();

-- Contract addition: report history is evidence too.
create trigger report_events_append_only before update or delete on public.report_events
  for each row execute function public.reject_mutation();
create trigger report_events_no_truncate before truncate on public.report_events
  for each statement execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- Audit triggers for the map (route_nodes / route_edges)
-- Writes only when a real caller is present (signed-in user or service_role),
-- so bulk seeding from the SQL editor / migrations does not flood the log.
-- ---------------------------------------------------------------------------

create function public.audit_map_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor  uuid := auth.uid();
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_role   text;
  v_inst   uuid;
  v_row    record;
  v_details jsonb;
begin
  begin
    v_role := (v_claims::json) ->> 'role';
  exception when others then
    v_role := null;
  end;
  if v_actor is null and coalesce(v_role, '') <> 'service_role' then
    return null;
  end if;

  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  if tg_table_name = 'route_nodes' then
    v_inst := public.floor_institution(v_row.floor_id);
  else
    v_inst := public.node_institution(v_row.from_node_id);
  end if;

  if tg_op = 'INSERT' then
    v_details := jsonb_build_object('new', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    v_details := jsonb_build_object('old', to_jsonb(old));
  else
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
      into v_details
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key <> 'updated_at';
    if v_details is null then
      return null;  -- nothing but updated_at changed
    end if;
  end if;

  insert into public.audit_events (actor_id, institution_id, action, entity_type, entity_id, details)
  values (v_actor, v_inst, tg_table_name || '.' || lower(tg_op), tg_table_name, v_row.id::text, v_details);
  return null;
end $$;

create trigger route_nodes_audit after insert or update or delete on public.route_nodes
  for each row execute function public.audit_map_change();
create trigger route_edges_audit after insert or update or delete on public.route_edges
  for each row execute function public.audit_map_change();

-- ---------------------------------------------------------------------------
-- obstacle_reports: sanitise whatever the client sends on INSERT
-- ---------------------------------------------------------------------------

create function public.sanitize_report_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_inst uuid;
begin
  new.status           := 'submitted';
  new.assignee_id      := null;
  new.verified_by      := null;
  new.verified_at      := null;
  new.resolution_notes := null;
  new.created_at       := now();
  new.updated_at       := now();

  if v_uid is not null then
    new.reporter_id := v_uid;
    select institution_id into v_inst from public.profiles where id = v_uid;
    if v_inst is null then
      raise exception 'Your profile could not be found. Please sign out and sign in again.';
    end if;
    new.institution_id := v_inst;
    if new.photo_path is not null and split_part(new.photo_path, '/', 1) <> v_uid::text then
      raise exception 'That photo does not belong to you. Please attach a photo you uploaded yourself.';
    end if;
  else
    new.institution_id := coalesce(new.institution_id, '00000000-0000-0000-0000-000000000001');
  end if;

  if new.node_id is not null and public.node_institution(new.node_id) is distinct from new.institution_id then
    raise exception 'That place is not part of your campus map.';
  end if;
  if new.edge_id is not null and public.edge_institution(new.edge_id) is distinct from new.institution_id then
    raise exception 'That path is not part of your campus map.';
  end if;
  return new;
end $$;

create trigger obstacle_reports_sanitize before insert on public.obstacle_reports
  for each row execute function public.sanitize_report_insert();
