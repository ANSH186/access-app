-- AccessAble AI - 0003 RPC functions
-- All SECURITY DEFINER with a fixed search_path. Error messages are plain English
-- because the apps may show or speak them.

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------

create function public._log_audit(p_institution uuid, p_action text, p_entity_type text,
                                  p_entity_id text, p_details jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_events (actor_id, institution_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_institution, p_action, p_entity_type, p_entity_id, p_details);
$$;

create function public._emergency_event(p_alert uuid, p_type text, p_from text, p_to text,
                                        p_note text, p_visible boolean) returns public.emergency_events
language plpgsql security definer set search_path = public as $$
declare v_ev public.emergency_events;
begin
  insert into public.emergency_events (alert_id, actor_id, event_type, from_status, to_status, note, visible_to_user)
  values (p_alert, auth.uid(), p_type, p_from, p_to, p_note, p_visible)
  returning * into v_ev;
  return v_ev;
end $$;

-- Locks an alert row and checks the caller is admin/responder of its institution.
create function public._lock_alert_for_staff(p_alert_id uuid) returns public.emergency_alerts
language plpgsql security definer set search_path = public as $$
declare v_alert public.emergency_alerts;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;
  if not exists (select 1 from public.role_assignments
                  where user_id = auth.uid() and role in ('admin','responder')) then
    raise exception 'You do not have permission to respond to emergencies.';
  end if;
  select * into v_alert from public.emergency_alerts where id = p_alert_id for update;
  if not found then
    raise exception 'That emergency request was not found.';
  end if;
  if not public.has_role(v_alert.institution_id, array['admin','responder']) then
    raise exception 'You do not have permission to respond to emergencies.';
  end if;
  return v_alert;
end $$;

revoke all on function public._log_audit(uuid, text, text, text, jsonb),
  public._emergency_event(uuid, text, text, text, text, boolean),
  public._lock_alert_for_staff(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Emergency
-- ---------------------------------------------------------------------------

create function public.create_emergency(
  p_client_request_id     text,
  p_emergency_type        text default 'unspecified',
  p_message               text default null,
  p_node_id               uuid default null,
  p_location_source       text default 'unknown',
  p_location_label        text default null,
  p_location_observed_at  timestamptz default null,
  p_lat                   double precision default null,
  p_lng                   double precision default null,
  p_accuracy_m            double precision default null,
  p_is_test               boolean default true
) returns public.emergency_alerts
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  public.profiles;
  v_inst     public.institutions;
  v_alert    public.emergency_alerts;
  v_active   public.emergency_alerts;
  v_type     text;
  v_src      text;
  v_node     uuid;
  v_label    text;
  v_lat      double precision;
  v_lng      double precision;
  v_acc      double precision;
  v_observed timestamptz;
  v_is_test  boolean;
begin
  if v_uid is null then
    raise exception 'You need to be signed in to send an emergency request.';
  end if;
  if p_client_request_id is null or btrim(p_client_request_id) = '' then
    raise exception 'The emergency request is missing its request id. Please try again.';
  end if;

  -- Serialise per user so retries and double-taps cannot race each other.
  perform pg_advisory_xact_lock(hashtextextended('create_emergency:' || v_uid::text, 0));

  -- Idempotency: the same request id always returns the same alert.
  select * into v_alert from public.emergency_alerts
   where user_id = v_uid and client_request_id = p_client_request_id;
  if found then
    return v_alert;
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    raise exception 'Your profile could not be found. Please sign out and sign in again.';
  end if;
  select * into v_inst from public.institutions where id = v_profile.institution_id;

  v_is_test := coalesce(p_is_test, true) or v_inst.test_mode_only;

  -- Never refuse help because of a duplicate: return the open alert.
  select * into v_active from public.emergency_alerts
   where user_id = v_uid and status in ('triggered','acknowledged','responding','unable_to_contact')
   order by created_at desc limit 1 for update;
  if found then
    if v_active.is_test and not v_is_test then
      -- A real emergency must never be swallowed by a lingering test alert.
      update public.emergency_alerts set status = 'cancelled' where id = v_active.id;
      perform public._emergency_event(v_active.id, 'cancelled', v_active.status, 'cancelled',
        'Automatically closed because a real emergency request was sent.', false);
    else
      perform public._emergency_event(v_active.id, 'deduplicated', v_active.status, v_active.status,
        'Another request (id ' || p_client_request_id || ') arrived while this one was still open.'
        || coalesce(' Message: ' || left(btrim(p_message), 500), ''), false);
      perform public._log_audit(v_active.institution_id, 'emergency.deduplicated', 'emergency_alerts',
        v_active.id::text, jsonb_build_object('client_request_id', p_client_request_id));
      return v_active;
    end if;
  end if;

  v_type := case when p_emergency_type in ('unspecified','medical','lost','fall','unsafe','other')
                 then p_emergency_type else 'unspecified' end;

  if not v_profile.share_location_in_sos then
    -- The user opted out of sharing location: store none of it.
    v_src := 'unknown'; v_node := null; v_label := null; v_lat := null; v_lng := null;
    v_acc := null; v_observed := null;
  else
    v_src := case when p_location_source in ('qr_checkpoint','staff_confirmed','route_progress','gps','unknown')
                  then p_location_source else 'unknown' end;
    -- Bad location data must never block an SOS: drop what is invalid and carry on.
    v_node := null;
    if p_node_id is not null and public.node_institution(p_node_id) = v_inst.id then
      v_node := p_node_id;
    end if;
    if p_lat is not null and p_lng is not null
       and p_lat between -90 and 90 and p_lng between -180 and 180 then
      v_lat := p_lat; v_lng := p_lng;
      v_acc := case when p_accuracy_m is not null and p_accuracy_m >= 0 then p_accuracy_m end;
    end if;
    v_label := left(nullif(btrim(p_location_label), ''), 200);
    v_observed := case when p_location_observed_at is not null then least(p_location_observed_at, now()) end;
    if v_node is null and v_lat is null and v_label is null then
      v_src := 'unknown'; v_observed := null;
    elsif v_src = 'unknown' and v_lat is not null and v_node is null then
      v_src := 'gps';
    elsif v_src = 'gps' and v_lat is null then
      v_src := 'unknown';
    end if;
  end if;

  insert into public.emergency_alerts
    (user_id, institution_id, client_request_id, emergency_type, message, is_test, status,
     node_id, location_source, location_label, location_observed_at, lat, lng, accuracy_m)
  values
    (v_uid, v_inst.id, p_client_request_id, v_type, left(nullif(btrim(p_message), ''), 1000), v_is_test, 'triggered',
     v_node, v_src, v_label, v_observed, v_lat, v_lng, v_acc)
  returning * into v_alert;

  perform public._emergency_event(v_alert.id, 'triggered', null, 'triggered', v_alert.message, true);
  perform public._log_audit(v_alert.institution_id, 'emergency.triggered', 'emergency_alerts',
    v_alert.id::text, jsonb_build_object('is_test', v_alert.is_test, 'emergency_type', v_alert.emergency_type));
  return v_alert;
end $$;

create function public.cancel_emergency(p_alert_id uuid, p_reason text default null)
returns public.emergency_alerts
language plpgsql security definer set search_path = public as $$
declare
  v_alert public.emergency_alerts;
  v_from  text;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;
  select * into v_alert from public.emergency_alerts where id = p_alert_id for update;
  if not found or v_alert.user_id <> auth.uid() then
    raise exception 'That emergency request was not found.';
  end if;
  if v_alert.status not in ('triggered','acknowledged','responding','unable_to_contact') then
    raise exception 'This emergency request is already closed.';
  end if;
  v_from := v_alert.status;
  update public.emergency_alerts set status = 'cancelled' where id = v_alert.id returning * into v_alert;
  perform public._emergency_event(v_alert.id, 'cancelled', v_from, 'cancelled', left(nullif(btrim(p_reason), ''), 500), true);
  perform public._log_audit(v_alert.institution_id, 'emergency.cancelled', 'emergency_alerts', v_alert.id::text, null);
  return v_alert;
end $$;

create function public.emergency_acknowledge(p_alert_id uuid)
returns public.emergency_alerts
language plpgsql security definer set search_path = public as $$
declare v_alert public.emergency_alerts;
begin
  v_alert := public._lock_alert_for_staff(p_alert_id);
  if v_alert.status in ('resolved','cancelled') then
    raise exception 'This emergency request is already closed.';
  elsif v_alert.status <> 'triggered' then
    raise exception 'This emergency request has already been acknowledged.';
  end if;
  update public.emergency_alerts
     set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid()
   where id = v_alert.id returning * into v_alert;
  perform public._emergency_event(v_alert.id, 'acknowledged', 'triggered', 'acknowledged', null, true);
  perform public._log_audit(v_alert.institution_id, 'emergency.acknowledged', 'emergency_alerts', v_alert.id::text, null);
  return v_alert;
end $$;

create function public.emergency_assign(p_alert_id uuid, p_responder_id uuid)
returns public.emergency_alerts
language plpgsql security definer set search_path = public as $$
declare
  v_alert public.emergency_alerts;
  v_from  text;
begin
  v_alert := public._lock_alert_for_staff(p_alert_id);
  v_from := v_alert.status;
  if v_from in ('resolved','cancelled') then
    raise exception 'This emergency request is already closed.';
  end if;
  if p_responder_id is null or not exists (
       select 1 from public.role_assignments ra
        where ra.user_id = p_responder_id and ra.institution_id = v_alert.institution_id
          and ra.role in ('responder','admin')) then
    raise exception 'That person is not a responder, so the emergency cannot be assigned to them.';
  end if;

  if v_from = 'triggered' then
    update public.emergency_alerts
       set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid(),
           assigned_responder_id = p_responder_id
     where id = v_alert.id returning * into v_alert;
    perform public._emergency_event(v_alert.id, 'acknowledged', 'triggered', 'acknowledged', null, true);
  else
    update public.emergency_alerts set assigned_responder_id = p_responder_id
     where id = v_alert.id returning * into v_alert;
  end if;
  perform public._emergency_event(v_alert.id, 'assigned', v_from, v_alert.status, null, true);
  perform public._log_audit(v_alert.institution_id, 'emergency.assigned', 'emergency_alerts', v_alert.id::text,
    jsonb_build_object('responder_id', p_responder_id));
  return v_alert;
end $$;

create function public.emergency_set_status(p_alert_id uuid, p_status text, p_note text default null)
returns public.emergency_alerts
language plpgsql security definer set search_path = public as $$
declare
  v_alert public.emergency_alerts;
  v_from  text;
  v_note  text := nullif(btrim(p_note), '');
begin
  v_alert := public._lock_alert_for_staff(p_alert_id);
  v_from := v_alert.status;

  if p_status is null or p_status not in ('responding','unable_to_contact','resolved') then
    raise exception 'That status cannot be set here. Choose responding, unable to contact, or resolved.';
  end if;
  if v_from in ('resolved','cancelled') then
    raise exception 'This emergency request is already closed.';
  end if;
  if v_from = 'triggered' then
    raise exception 'Acknowledge this emergency request before changing its status.';
  end if;
  if v_from = p_status then
    raise exception 'This emergency request is already marked as %.', replace(p_status, '_', ' ');
  end if;
  -- acknowledged -> responding | unable_to_contact | resolved
  -- responding -> unable_to_contact | resolved ; unable_to_contact -> responding | resolved
  if not ((v_from = 'acknowledged'      and p_status in ('responding','unable_to_contact','resolved'))
       or (v_from = 'responding'        and p_status in ('unable_to_contact','resolved'))
       or (v_from = 'unable_to_contact' and p_status in ('responding','resolved'))) then
    raise exception 'This emergency request cannot move from % to %.', replace(v_from, '_', ' '), replace(p_status, '_', ' ');
  end if;
  if p_status = 'resolved' and v_note is null then
    raise exception 'Please add a note describing how this emergency was resolved.';
  end if;

  if p_status = 'resolved' then
    update public.emergency_alerts
       set status = 'resolved', resolved_at = now(), resolution_notes = v_note
     where id = v_alert.id returning * into v_alert;
  else
    update public.emergency_alerts set status = p_status
     where id = v_alert.id returning * into v_alert;
  end if;

  -- The status change itself is visible to the user; the free-text note is internal.
  perform public._emergency_event(v_alert.id, 'status_changed', v_from, p_status, null, true);
  if v_note is not null and p_status <> 'resolved' then
    perform public._emergency_event(v_alert.id, 'note', v_from, p_status, v_note, false);
  end if;
  perform public._log_audit(v_alert.institution_id, 'emergency.status_changed', 'emergency_alerts', v_alert.id::text,
    jsonb_build_object('from', v_from, 'to', p_status));
  return v_alert;
end $$;

create function public.emergency_add_note(p_alert_id uuid, p_note text, p_visible_to_user boolean default false)
returns public.emergency_events
language plpgsql security definer set search_path = public as $$
declare
  v_alert public.emergency_alerts;
  v_ev    public.emergency_events;
begin
  v_alert := public._lock_alert_for_staff(p_alert_id);
  if p_note is null or btrim(p_note) = '' then
    raise exception 'The note is empty. Please write something first.';
  end if;
  v_ev := public._emergency_event(v_alert.id, 'note', v_alert.status, v_alert.status, btrim(p_note),
                                  coalesce(p_visible_to_user, false));
  perform public._log_audit(v_alert.institution_id, 'emergency.note', 'emergency_alerts', v_alert.id::text,
    jsonb_build_object('event_id', v_ev.id, 'visible_to_user', v_ev.visible_to_user));
  return v_ev;
end $$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create function public.report_transition(
  p_report_id    uuid,
  p_to_status    text,
  p_note         text default null,
  p_block_edge   boolean default false,
  p_assignee_id  uuid default null,
  p_edge_id      uuid default null   -- which path to block; defaults to the report's own edge_id
) returns public.obstacle_reports
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_report  public.obstacle_reports;
  v_from    text;
  v_note    text := nullif(btrim(p_note), '');
  v_edge    public.route_edges;
  v_can_map boolean;
  v_edge_id uuid;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.';
  end if;
  if not exists (select 1 from public.role_assignments
                  where user_id = v_uid and role in ('admin','maintenance','map_editor')) then
    raise exception 'Only maintenance, map editor or admin staff can update reports.';
  end if;

  select * into v_report from public.obstacle_reports where id = p_report_id for update;
  if not found then
    raise exception 'That report was not found.';
  end if;
  if not public.has_role(v_report.institution_id, array['admin','maintenance','map_editor']) then
    raise exception 'Only maintenance, map editor or admin staff can update reports.';
  end if;
  v_can_map := public.has_role(v_report.institution_id, array['admin','map_editor']);
  v_from := v_report.status;

  if not ((v_from || '>' || coalesce(p_to_status, '')) = any (array[
      'submitted>under_review','submitted>verified','submitted>rejected',
      'under_review>verified','under_review>rejected',
      'verified>assigned','verified>resolved',
      'assigned>resolved',
      'resolved>closed','resolved>reopened',
      'closed>reopened','rejected>reopened',
      'reopened>under_review','reopened>verified'])) then
    raise exception 'A report that is % cannot be changed to %.', replace(v_from, '_', ' '), replace(coalesce(p_to_status, 'nothing'), '_', ' ');
  end if;

  if p_to_status = 'assigned' then
    if p_assignee_id is null then
      raise exception 'Choose who the report is assigned to.';
    end if;
    if not exists (select 1 from public.role_assignments ra
                    where ra.user_id = p_assignee_id and ra.institution_id = v_report.institution_id
                      and ra.role in ('admin','maintenance','map_editor')) then
      raise exception 'That person is not on the maintenance or map staff, so the report cannot be assigned to them.';
    end if;
  end if;

  if p_block_edge and p_to_status <> 'verified' then
    raise exception 'A path can only be blocked when a report is marked as verified.';
  end if;
  if p_block_edge and p_to_status = 'verified' then
    if not v_can_map then
      raise exception 'Only an admin or map editor can block a path.';
    end if;
    v_edge_id := coalesce(p_edge_id, v_report.edge_id);
    if v_edge_id is null then
      raise exception 'Choose which path to block for this report.';
    end if;
    select * into v_edge from public.route_edges where id = v_edge_id for update;
    if not found then
      raise exception 'That path no longer exists.';
    end if;
    if public.edge_institution(v_edge.id) is distinct from v_report.institution_id then
      raise exception 'That path is not part of this campus map.';
    end if;
    update public.route_edges
       set status = 'blocked',
           blocked_reason = replace(v_report.category, '_', ' ') || coalesce(': ' || nullif(btrim(v_report.description), ''), ''),
           blocked_by_report_id = v_report.id
     where id = v_edge.id;
  end if;

  -- Paths held closed by this report are released when it ends.
  if p_to_status in ('resolved','closed','rejected') then
    update public.route_edges
       set status = 'open', blocked_reason = null, blocked_by_report_id = null
     where blocked_by_report_id = v_report.id;
  end if;

  update public.obstacle_reports r
     set status = p_to_status,
         assignee_id = case when p_to_status = 'assigned' then p_assignee_id else r.assignee_id end,
         verified_by = case when p_to_status = 'verified' then v_uid else r.verified_by end,
         verified_at = case when p_to_status = 'verified' then now() else r.verified_at end,
         edge_id = case when v_edge_id is not null then v_edge_id else r.edge_id end,
         resolution_notes = case when p_to_status = 'resolved' then coalesce(v_note, r.resolution_notes) else r.resolution_notes end
   where r.id = v_report.id
   returning * into v_report;

  insert into public.report_events (report_id, actor_id, from_status, to_status, note)
  values (v_report.id, v_uid, v_from, p_to_status, v_note);

  perform public._log_audit(v_report.institution_id, 'report.transition', 'obstacle_reports', v_report.id::text,
    jsonb_build_object('from', v_from, 'to', p_to_status, 'block_edge', coalesce(p_block_edge, false),
                       'edge_id', coalesce(v_edge_id, v_report.edge_id), 'assignee_id', p_assignee_id));
  return v_report;
end $$;

-- ---------------------------------------------------------------------------
-- Staff directory (for assign pickers). Any staff member may list staff names.
-- ---------------------------------------------------------------------------
create function public.list_staff(p_roles text[] default null)
returns table (user_id uuid, display_name text, phone text, roles text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_inst uuid := public.my_institution();
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;
  if not public.has_role(v_inst, array['admin','responder','maintenance','map_editor']) then
    raise exception 'Only campus staff can see the staff list.';
  end if;
  return query
    select ra.user_id, p.display_name, p.phone, array_agg(ra.role order by ra.role)
      from public.role_assignments ra
      left join public.profiles p on p.id = ra.user_id
     where ra.institution_id = v_inst
       and (p_roles is null or ra.role = any (p_roles))
     group by ra.user_id, p.display_name, p.phone
     order by p.display_name nulls last;
end $$;
revoke all on function public.list_staff(text[]) from public, anon;
grant execute on function public.list_staff(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Map
-- ---------------------------------------------------------------------------

create function public.set_edge_status(p_edge_id uuid, p_status text, p_reason text default null)
returns public.route_edges
language plpgsql security definer set search_path = public as $$
declare
  v_edge public.route_edges;
  v_inst uuid;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;
  if p_status is null or p_status not in ('open','blocked') then
    raise exception 'A path can only be set to open or blocked.';
  end if;
  select * into v_edge from public.route_edges where id = p_edge_id for update;
  if not found then
    raise exception 'That path was not found.';
  end if;
  v_inst := public.node_institution(v_edge.from_node_id);
  if not public.has_role(v_inst, array['admin','map_editor']) then
    raise exception 'Only an admin or map editor can open or block paths.';
  end if;

  if p_status = 'blocked' then
    update public.route_edges
       set status = 'blocked', blocked_reason = coalesce(nullif(btrim(p_reason), ''), 'Blocked by map staff'),
           blocked_by_report_id = null
     where id = v_edge.id returning * into v_edge;
  else
    update public.route_edges
       set status = 'open', blocked_reason = null, blocked_by_report_id = null
     where id = v_edge.id returning * into v_edge;
  end if;
  perform public._log_audit(v_inst, 'edge.set_status', 'route_edges', v_edge.id::text,
    jsonb_build_object('status', p_status, 'reason', p_reason));
  return v_edge;
end $$;

create function public.resolve_checkpoint(p_qr_token text)
returns table (node_id uuid, node_code text, label text, kind text, floor_id uuid,
               floor_level int, floor_name text, building_name text, verified boolean)
language sql stable security definer set search_path = public as $$
  select n.id, n.code, n.label, n.kind, f.id, f.level, f.name, b.name, n.verified
    from public.route_nodes n
    join public.floors f on f.id = n.floor_id
    join public.buildings b on b.id = f.building_id
   where auth.uid() is not null
     and n.qr_token = btrim(p_qr_token)
     and b.institution_id = public.my_institution();
$$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only
-- ---------------------------------------------------------------------------

revoke all on function
  public.create_emergency(text, text, text, uuid, text, text, timestamptz, double precision, double precision, double precision, boolean),
  public.cancel_emergency(uuid, text),
  public.emergency_acknowledge(uuid),
  public.emergency_assign(uuid, uuid),
  public.emergency_set_status(uuid, text, text),
  public.emergency_add_note(uuid, text, boolean),
  public.report_transition(uuid, text, text, boolean, uuid, uuid),
  public.set_edge_status(uuid, text, text),
  public.resolve_checkpoint(text)
from public, anon;

grant execute on function
  public.create_emergency(text, text, text, uuid, text, text, timestamptz, double precision, double precision, double precision, boolean),
  public.cancel_emergency(uuid, text),
  public.emergency_acknowledge(uuid),
  public.emergency_assign(uuid, uuid),
  public.emergency_set_status(uuid, text, text),
  public.emergency_add_note(uuid, text, boolean),
  public.report_transition(uuid, text, text, boolean, uuid, uuid),
  public.set_edge_status(uuid, text, text),
  public.resolve_checkpoint(text)
to authenticated;
