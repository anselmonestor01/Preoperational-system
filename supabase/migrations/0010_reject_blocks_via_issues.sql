-- =============================================================================
-- MUNDO MARÍTIMO — Migración 0010 (FASE 2)
-- Estado de vehículo más claro: un rechazo (NO AUTORIZADO) bloquea el vehículo
-- por sus NOVEDADES (issues), no por admin_blocked. Así:
--   - admin_blocked = SÓLO bloqueo administrativo MANUAL (o por override reject).
--   - Un vehículo rechazado queda 'issues' hasta que se resuelvan sus novedades.
-- Esto separa los conceptos (requisito de arquitectura) y hace que
-- "Desbloquear" y "Resolver y liberar" tengan semántica clara y única.
-- =============================================================================

-- Recrear submit_inspection SIN el auto-bloqueo administrativo en rechazo.
create or replace function public.submit_inspection(
  p_vehicle_id uuid, p_driver_id uuid, p_answers jsonb,
  p_km_inicial int, p_fuel_in text, p_obs text, p_idempotency_key text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid();
  v_round public.rounds; v_veh public.vehicles; v_ver public.checklist_versions;
  v_maxbad int; v_elem jsonb;
  v_type app.item_type; v_sev app.answer_severity; v_crit boolean;
  v_ok int:=0; v_warn int:=0; v_bad int:=0; v_total int:=0; v_noncrit_bad int:=0;
  v_reasons text[] := '{}'; v_authorized boolean; v_result app.inspection_result;
  v_insp_id uuid; v_existing public.inspections; v_issue_id uuid; v_ev text;
  v_name text; v_item_id uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin')
    then raise exception 'No autorizado'; end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.inspections
      where organization_id=v_org and idempotency_key=p_idempotency_key;
    if found then
      return jsonb_build_object('id', v_existing.id, 'authorized', v_existing.authorized,
        'result', v_existing.result, 'status', v_existing.status,
        'reasons', v_existing.auth_reasons, 'idempotent', true);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_org::text), hashtext(p_vehicle_id::text));

  select * into v_round from public.rounds
    where organization_id=v_org and status='open' order by round_number desc limit 1 for update;
  if not found then raise exception 'No hay una ronda abierta'; end if;

  select * into v_veh from public.vehicles where id=p_vehicle_id and organization_id=v_org for update;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if v_veh.status <> 'active' then raise exception 'El vehículo no está activo'; end if;
  if v_veh.admin_blocked then
    raise exception 'El vehículo está bloqueado por administración: %', coalesce(v_veh.admin_block_reason,'sin motivo');
  end if;
  if exists (select 1 from public.issues where vehicle_id=p_vehicle_id and organization_id=v_org and status <> 'resolved') then
    raise exception 'El vehículo tiene novedades pendientes sin resolver';
  end if;
  if exists (select 1 from public.inspections where vehicle_id=p_vehicle_id and round_id=v_round.id
             and status in ('submitted','authorized','rejected','closed') and released=false) then
    raise exception 'Este vehículo ya fue inspeccionado en la ronda actual';
  end if;

  select max_non_critical_bad into v_maxbad from public.organizations where id=v_org;
  select * into v_ver from public.checklist_versions where organization_id=v_org and active limit 1;

  for v_elem in select * from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb)) loop
    v_type := (v_elem->>'item_type')::app.item_type;
    v_sev  := app.severity_of(v_type, v_elem->>'value');
    if v_sev is null then continue; end if;
    v_total := v_total + 1;
    v_name := coalesce(v_elem->>'item_name','');
    v_item_id := nullif(v_elem->>'item_id','')::uuid;
    v_crit := false;
    if v_item_id is not null then
      select is_safety_critical into v_crit from public.checklist_items where id=v_item_id;
      v_crit := coalesce(v_crit,false);
    end if;
    if v_sev='ok' then v_ok := v_ok+1;
    elsif v_sev='warn' then v_warn := v_warn+1;
    else
      v_bad := v_bad+1;
      if v_crit then v_reasons := array_append(v_reasons, 'Falla crítica de seguridad: '||v_name);
      else v_noncrit_bad := v_noncrit_bad + 1; end if;
    end if;
  end loop;

  if v_noncrit_bad >= v_maxbad then
    v_reasons := array_append(v_reasons, v_noncrit_bad||' fallas en estado "Malo" (límite: '||v_maxbad||')');
  end if;
  v_authorized := (array_length(v_reasons,1) is null);
  if v_bad=0 and v_warn=0 then v_result := 'bueno';
  elsif not v_authorized then v_result := 'malo';
  elsif v_bad>0 then v_result := 'malo';
  else v_result := 'regular'; end if;

  select * into v_existing from public.inspections
    where vehicle_id=p_vehicle_id and round_id=v_round.id and status='in_progress';
  if found then
    update public.inspections set
      driver_id=p_driver_id, driver_name=(select full_name from public.drivers where id=p_driver_id),
      vehicle_plate=v_veh.plate, checklist_version_id=v_ver.id,
      checklist_version_number=v_ver.version_number, checklist_snapshot=v_ver.structure,
      answers=coalesce(p_answers,'[]'::jsonb),
      status=(case when v_authorized then 'authorized' else 'rejected' end)::app.inspection_status,
      result=v_result, authorized=v_authorized, auth_reasons=to_jsonb(v_reasons),
      km_inicial=p_km_inicial, fuel_in=p_fuel_in, obs_general=coalesce(p_obs,''),
      ok_count=v_ok, warn_count=v_warn, bad_count=v_bad, total_items=v_total,
      operation_status=(case when v_authorized then 'open' else 'none' end)::app.operation_status,
      idempotency_key=p_idempotency_key, created_by=v_uid,
      submitted_at=now(), authorized_at=(case when v_authorized then now() else null end)
    where id=v_existing.id returning id into v_insp_id;
  else
    insert into public.inspections(
      organization_id, round_id, vehicle_id, driver_id, vehicle_plate, driver_name,
      checklist_version_id, checklist_version_number, checklist_snapshot, answers,
      status, result, authorized, auth_reasons, km_inicial, fuel_in, obs_general,
      ok_count, warn_count, bad_count, total_items, operation_status,
      idempotency_key, created_by, submitted_at, authorized_at)
    values (
      v_org, v_round.id, p_vehicle_id, p_driver_id, v_veh.plate,
      (select full_name from public.drivers where id=p_driver_id),
      v_ver.id, v_ver.version_number, v_ver.structure, coalesce(p_answers,'[]'::jsonb),
      (case when v_authorized then 'authorized' else 'rejected' end)::app.inspection_status,
      v_result, v_authorized, to_jsonb(v_reasons), p_km_inicial, p_fuel_in, coalesce(p_obs,''),
      v_ok, v_warn, v_bad, v_total,
      (case when v_authorized then 'open' else 'none' end)::app.operation_status,
      p_idempotency_key, v_uid, now(), (case when v_authorized then now() else null end))
    returning id into v_insp_id;
  end if;

  delete from public.inspection_answers where inspection_id=v_insp_id;
  for v_elem in select * from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb)) loop
    v_type := (v_elem->>'item_type')::app.item_type;
    v_sev  := app.severity_of(v_type, v_elem->>'value');
    if v_sev is null then continue; end if;
    insert into public.inspection_answers(
      organization_id, inspection_id, category_key, item_id, item_name, item_type, value, severity)
    values (v_org, v_insp_id, v_elem->>'category_key', nullif(v_elem->>'item_id','')::uuid,
      coalesce(v_elem->>'item_name',''), v_type, v_elem->>'value', v_sev);
    if v_sev in ('warn','bad') then
      insert into public.issues(
        organization_id, inspection_id, vehicle_id, driver_id, round_id,
        category_key, item_name, severity, description, due_date, status)
      values (v_org, v_insp_id, p_vehicle_id, p_driver_id, v_round.id,
        v_elem->>'category_key', coalesce(v_elem->>'item_name',''), v_sev,
        coalesce(v_elem->>'note',''), nullif(v_elem->>'due_date','')::date, 'pending')
      returning id into v_issue_id;
      if v_elem ? 'evidence' then
        for v_ev in select * from jsonb_array_elements_text(v_elem->'evidence') loop
          insert into public.issue_evidence(organization_id, issue_id, inspection_id, storage_path, created_by)
          values (v_org, v_issue_id, v_insp_id, v_ev, v_uid);
        end loop;
      end if;
    end if;
  end loop;

  -- NOTA: un rechazo NO fija admin_blocked. Las novedades críticas creadas
  -- arriba dejan el vehículo en estado 'issues' (bloqueado) hasta resolverlas.

  perform app.write_audit('inspection_submitted','inspection', v_insp_id::text, null,
    jsonb_build_object('authorized',v_authorized,'result',v_result,'reasons',to_jsonb(v_reasons)),
    jsonb_build_object('vehicle',v_veh.plate,'round',v_round.round_number));

  return jsonb_build_object('id',v_insp_id,'authorized',v_authorized,'result',v_result,
    'status',(case when v_authorized then 'authorized' else 'rejected' end),
    'reasons',to_jsonb(v_reasons),'ok',v_ok,'warn',v_warn,'bad',v_bad,'idempotent',false);
exception
  when unique_violation then
    select * into v_existing from public.inspections
      where vehicle_id=p_vehicle_id and round_id=v_round.id
        and status in ('submitted','authorized','rejected','closed') and released=false limit 1;
    return jsonb_build_object('id', v_existing.id, 'authorized', v_existing.authorized,
      'result', v_existing.result, 'status', v_existing.status,
      'reasons', v_existing.auth_reasons, 'idempotent', true);
end; $$;

-- Limpieza: los bloqueos administrativos AUTOMÁTICOS de rechazos previos se
-- retiran (el vehículo sigue bloqueado por sus novedades si aún están abiertas).
update public.vehicles
set admin_blocked=false, admin_block_reason='', blocked_at=null, blocked_by=null
where admin_blocked = true and admin_block_reason like 'NO AUTORIZADO%';
