-- AccessAble AI - 0002 row level security, helpers and grants

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so policies can read role/profile/map tables safely)
-- ---------------------------------------------------------------------------

create function public.has_role(p_institution uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.role_assignments ra
     where ra.user_id = auth.uid()
       and ra.institution_id = p_institution
       and ra.role = any (p_roles)
  );
$$;

create function public.my_institution() returns uuid
language sql stable security definer set search_path = public as $$
  select p.institution_id from public.profiles p where p.id = auth.uid();
$$;

-- Contract additions: institution lookups for map rows (they have no institution_id column).
create function public.building_institution(p_building uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select b.institution_id from public.buildings b where b.id = p_building;
$$;

create function public.floor_institution(p_floor uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select b.institution_id from public.floors f join public.buildings b on b.id = f.building_id where f.id = p_floor;
$$;

create function public.node_institution(p_node uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select b.institution_id
    from public.route_nodes n
    join public.floors f on f.id = n.floor_id
    join public.buildings b on b.id = f.building_id
   where n.id = p_node;
$$;

create function public.edge_institution(p_edge uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select public.node_institution(e.from_node_id) from public.route_edges e where e.id = p_edge;
$$;

revoke all on function public.has_role(uuid, text[]), public.my_institution(),
  public.building_institution(uuid), public.floor_institution(uuid),
  public.node_institution(uuid), public.edge_institution(uuid) from public, anon;
grant execute on function public.has_role(uuid, text[]), public.my_institution(),
  public.building_institution(uuid), public.floor_institution(uuid),
  public.node_institution(uuid), public.edge_institution(uuid) to authenticated;

-- Internal trigger functions: nobody calls them directly.
revoke all on function public.set_updated_at(), public.handle_new_user(), public.reject_mutation(),
  public.audit_map_change(), public.sanitize_report_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges: start from nothing, then grant the minimum.
-- (Supabase default privileges hand out broad grants; remove them.)
-- ---------------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to authenticated;

grant select on public.institutions, public.profiles, public.role_assignments, public.buildings,
                public.floors, public.route_nodes, public.route_edges, public.obstacle_reports,
                public.report_events, public.emergency_alerts, public.emergency_events,
                public.audit_events
  to authenticated;

grant insert, update, delete on public.buildings, public.floors, public.route_nodes, public.route_edges to authenticated;
grant insert on public.obstacle_reports to authenticated;
grant insert, delete on public.role_assignments to authenticated;
-- Users may edit only their own preferences; never institution_id.
grant update (display_name, phone, emergency_contact_name, emergency_contact_phone,
              share_location_in_sos, speech_rate, avoid_stairs)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.institutions      enable row level security;
alter table public.profiles          enable row level security;
alter table public.role_assignments  enable row level security;
alter table public.buildings         enable row level security;
alter table public.floors            enable row level security;
alter table public.route_nodes       enable row level security;
alter table public.route_edges       enable row level security;
alter table public.obstacle_reports  enable row level security;
alter table public.report_events     enable row level security;
alter table public.emergency_alerts  enable row level security;
alter table public.emergency_events  enable row level security;
alter table public.audit_events      enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Reference + map data: readable by every signed-in user.
create policy institutions_select on public.institutions for select to authenticated using (true);
create policy buildings_select    on public.buildings    for select to authenticated using (true);
create policy floors_select       on public.floors       for select to authenticated using (true);
create policy route_nodes_select  on public.route_nodes  for select to authenticated using (true);
create policy route_edges_select  on public.route_edges  for select to authenticated using (true);

-- Map edits: admin / map_editor of the owning institution.
create policy buildings_insert on public.buildings for insert to authenticated
  with check (public.has_role(institution_id, array['admin','map_editor']));
create policy buildings_update on public.buildings for update to authenticated
  using (public.has_role(institution_id, array['admin','map_editor']))
  with check (public.has_role(institution_id, array['admin','map_editor']));
create policy buildings_delete on public.buildings for delete to authenticated
  using (public.has_role(institution_id, array['admin','map_editor']));

create policy floors_insert on public.floors for insert to authenticated
  with check (public.has_role(public.building_institution(building_id), array['admin','map_editor']));
create policy floors_update on public.floors for update to authenticated
  using (public.has_role(public.building_institution(building_id), array['admin','map_editor']))
  with check (public.has_role(public.building_institution(building_id), array['admin','map_editor']));
create policy floors_delete on public.floors for delete to authenticated
  using (public.has_role(public.building_institution(building_id), array['admin','map_editor']));

create policy route_nodes_insert on public.route_nodes for insert to authenticated
  with check (public.has_role(public.floor_institution(floor_id), array['admin','map_editor']));
create policy route_nodes_update on public.route_nodes for update to authenticated
  using (public.has_role(public.floor_institution(floor_id), array['admin','map_editor']))
  with check (public.has_role(public.floor_institution(floor_id), array['admin','map_editor']));
create policy route_nodes_delete on public.route_nodes for delete to authenticated
  using (public.has_role(public.floor_institution(floor_id), array['admin','map_editor']));

create policy route_edges_insert on public.route_edges for insert to authenticated
  with check (public.has_role(public.node_institution(from_node_id), array['admin','map_editor'])
          and public.node_institution(from_node_id) is not distinct from public.node_institution(to_node_id));
create policy route_edges_update on public.route_edges for update to authenticated
  using (public.has_role(public.node_institution(from_node_id), array['admin','map_editor']))
  with check (public.has_role(public.node_institution(from_node_id), array['admin','map_editor'])
          and public.node_institution(from_node_id) is not distinct from public.node_institution(to_node_id));
create policy route_edges_delete on public.route_edges for delete to authenticated
  using (public.has_role(public.node_institution(from_node_id), array['admin','map_editor']));

-- profiles
-- Admins see everyone in their institution (to manage roles). Responders see only staff and
-- people who have raised an SOS in the last 30 days (so emergency contacts are not browsable).
create function public._is_staff(p_user uuid, p_institution uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.role_assignments
                  where user_id = p_user and institution_id = p_institution);
$$;
create function public._has_recent_alert(p_user uuid, p_institution uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.emergency_alerts
                  where user_id = p_user and institution_id = p_institution
                    and created_at > now() - interval '30 days');
$$;
revoke all on function public._is_staff(uuid, uuid), public._has_recent_alert(uuid, uuid) from public, anon;
grant execute on function public._is_staff(uuid, uuid), public._has_recent_alert(uuid, uuid) to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.has_role(institution_id, array['admin'])
    or (public.has_role(institution_id, array['responder'])
        and (public._is_staff(id, institution_id) or public._has_recent_alert(id, institution_id)))
  );
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and institution_id = public.my_institution());

-- role_assignments
create policy role_assignments_select on public.role_assignments for select to authenticated
  using (user_id = auth.uid() or public.has_role(institution_id, array['admin']));
create policy role_assignments_insert on public.role_assignments for insert to authenticated
  with check (public.has_role(institution_id, array['admin']));
create policy role_assignments_delete on public.role_assignments for delete to authenticated
  using (public.has_role(institution_id, array['admin']));

-- obstacle_reports: insert own (trigger sanitises), read own or as staff, never update directly.
create policy obstacle_reports_select on public.obstacle_reports for select to authenticated
  using (reporter_id = auth.uid()
         or public.has_role(institution_id, array['admin','maintenance','map_editor']));
create policy obstacle_reports_insert on public.obstacle_reports for insert to authenticated
  with check (reporter_id = auth.uid()
              and status = 'submitted'
              and institution_id = public.my_institution());

-- report_events
create policy report_events_select on public.report_events for select to authenticated
  using (exists (
    select 1 from public.obstacle_reports r
     where r.id = report_events.report_id
       and (r.reporter_id = auth.uid()
            or public.has_role(r.institution_id, array['admin','maintenance','map_editor']))
  ));

-- emergency_alerts: read only. All writes go through RPC.
create policy emergency_alerts_select on public.emergency_alerts for select to authenticated
  using (user_id = auth.uid() or public.has_role(institution_id, array['admin','responder']));

-- emergency_events: users see only user-visible events of their own alerts.
create policy emergency_events_select on public.emergency_events for select to authenticated
  using (exists (
    select 1 from public.emergency_alerts a
     where a.id = emergency_events.alert_id
       and ((a.user_id = auth.uid() and emergency_events.visible_to_user)
            or public.has_role(a.institution_id, array['admin','responder']))
  ));

-- audit_events: admins only
create policy audit_events_select on public.audit_events for select to authenticated
  using (public.has_role(institution_id, array['admin']));
