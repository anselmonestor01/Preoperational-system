-- =============================================================================
-- MUNDO MARÍTIMO — Migración 0004: Funciones RPC (reglas de negocio server-side)
-- -----------------------------------------------------------------------------
-- Todas SECURITY DEFINER: son la ÚNICA vía para transiciones críticas. Aquí
-- vive la verdad del sistema (resultado, autorización, bloqueo, idempotencia,
-- concurrencia, auditoría). El cliente nunca decide autorización ni estado.
-- =============================================================================

-- Auditoría interna (append-only). Sólo invocable desde otras funciones definer.
create or replace function app.write_audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_old jsonb, p_new jsonb, p_context jsonb)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_label text;
begin
  select coalesce(full_name,'') || ' <' || coalesce(email,'') || '>'
    into v_label from public.profiles where id = auth.uid();
  insert into public.audit_logs(
    organization_id, actor_profile_id, actor_label, action,
    entity_type, entity_id, old_value, new_value, context)
  values (app.current_org(), auth.uid(), v_label, p_action,
    p_entity_type, p_entity_id, p_old, p_new, p_context);
end;
$$;

-- Bootstrap: perfil + organización + ronda activa + versión de checklist.
create or replace function public.app_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid; v_out jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  v_org := app.current_org();
  if v_org is null then raise exception 'Usuario sin organización o inactivo'; end if;
  select jsonb_build_object(
    'profile', (select to_jsonb(p) - 'organization_id' from public.profiles p where p.id = auth.uid()),
    'organization', (select to_jsonb(o) from public.organizations o where o.id = v_org),
    'active_round', (select to_jsonb(r) from public.rounds r
                     where r.organization_id = v_org and r.status='open'
                     order by r.round_number desc limit 1),
    'checklist_version', (select jsonb_build_object('id',id,'version_number',version_number)
                     from public.checklist_versions
                     where organization_id = v_org and active limit 1)
  ) into v_out;
  return v_out;
end;
$$;

-- Verificación de PIN del conductor (server-side; el PIN nunca vive en el front).
create or replace function public.verify_driver_pin(p_driver_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare v_org uuid; v_drv public.drivers; v_ok boolean := false;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin')
    then raise exception 'No autorizado'; end if;
  select * into v_drv from public.drivers
    where id = p_driver_id and organization_id = v_org and active = true;
  if not found then return jsonb_build_object('ok', false, 'reason','not_found'); end if;
  if v_drv.pin_hash is not null and p_pin is not null
     and v_drv.pin_hash = extensions.crypt(p_pin, v_drv.pin_hash) then
    v_ok := true;
  end if;
  perform app.write_audit(
    case when v_ok then 'driver_pin_ok' else 'driver_pin_failed' end,
    'driver', p_driver_id::text, null, null,
    jsonb_build_object('driver', v_drv.full_name));
  return jsonb_build_object('ok', v_ok, 'driver_id', v_drv.id, 'full_name', v_drv.full_name);
end;
$$;

-- Guardar/actualizar BORRADOR de inspección en el servidor (recuperación real).
create or replace function public.save_inspection_draft(
  p_vehicle_id uuid, p_driver_id uuid, p_answers jsonb,
  p_km_inicial int, p_fuel_in text, p_obs text)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid; v_round public.rounds; v_id uuid; v_plate text; v_drv text;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin')
    then raise exception 'No autorizado'; end if;
  select * into v_round from public.rounds
    where organization_id = v_org and status='open' order by round_number desc limit 1;
  if not found then raise exception 'No hay una ronda abierta'; end if;
  select plate into v_plate from public.vehicles where id=p_vehicle_id and organization_id=v_org;
  select full_name into v_drv from public.drivers where id=p_driver_id and organization_id=v_org;

  insert into public.inspections(
    organization_id, round_id, vehicle_id, driver_id, vehicle_plate, driver_name,
    answers, km_inicial, fuel_in, obs_general, status, created_by, submitted_at)
  values (v_org, v_round.id, p_vehicle_id, p_driver_id, v_plate, v_drv,
    coalesce(p_answers,'[]'::jsonb), p_km_inicial, p_fuel_in, coalesce(p_obs,''),
    'in_progress', auth.uid(), null)
  on conflict (vehicle_id, round_id) where (status='in_progress')
  do update set answers = excluded.answers, km_inicial = excluded.km_inicial,
     fuel_in = excluded.fuel_in, obs_general = excluded.obs_general,
     driver_id = excluded.driver_id, driver_name = excluded.driver_name,
     updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- =============================================================================
-- submit_inspection: EL corazón. Recalcula todo en servidor.
-- p_answers: array de objetos:
--   {category_key, item_id, item_name, item_type, value, note?, due_date?, evidence?[]}
-- =============================================================================
create or replace function public.submit_inspection(
  p_vehicle_id uuid, p_driver_id uuid, p_answers jsonb,
  p_km_inicial int, p_fuel_in text, p_obs text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_org uuid; v_uid uuid := auth.uid();
  v_round public.rounds; v_veh public.vehicles; v_ver public.checklist_versions;
  v_maxbad int; v_ans jsonb; v_elem jsonb;
  v_type app.item_type; v_sev app.answer_severity; v_crit boolean;
  v_ok int:=0; v_warn int:=0; v_bad int:=0; v_total int:=0; v_noncrit_bad int:=0;
  v_reasons text[] := '{}'; v_authorized boolean; v_result app.inspection_result;
  v_insp_id uuid; v_existing public.inspections; v_issue_id uuid; v_ev text;
  v_name text; v_item_id uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin')
    then raise exception 'No autorizado'; end if;

  -- Idempotencia: si ya existe una inspección con esta clave, devolverla.
  if p_idempotency_key is not null then
    select * into v_existing from public.inspections
      where organization_id=v_org and idempotency_key=p_idempotency_key;
    if found then
      return jsonb_build_object('id', v_existing.id, 'authorized', v_existing.authorized,
        'result', v_existing.result, 'status', v_existing.status,
        'reasons', v_existing.auth_reasons, 'idempotent', true);
    end if;
  end if;

  -- Serializar por vehículo (evita doble envío concurrente del mismo vehículo).
  perform pg_advisory_xact_lock(hashtext(v_org::text), hashtext(p_vehicle_id::text));

  select * into v_round from public.rounds
    where organization_id=v_org and status='open' order by round_number desc limit 1
    for update;
  if not found then raise exception 'No hay una ronda abierta'; end if;

  select * into v_veh from public.vehicles
    where id=p_vehicle_id and organization_id=v_org for update;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if v_veh.status <> 'active' then raise exception 'El vehículo no está activo'; end if;
  if v_veh.admin_blocked then
    raise exception 'El vehículo está bloqueado por administración: %', coalesce(v_veh.admin_block_reason,'sin motivo');
  end if;
  if exists (select 1 from public.issues
             where vehicle_id=p_vehicle_id and organization_id=v_org and status <> 'resolved') then
    raise exception 'El vehículo tiene novedades pendientes sin resolver';
  end if;
  -- Anti doble inspección en la ronda (además del índice único de respaldo).
  if exists (select 1 from public.inspections
             where vehicle_id=p_vehicle_id and round_id=v_round.id
               and status in ('submitted','authorized','rejected','closed')
               and released=false) then
    raise exception 'Este vehículo ya fue inspeccionado en la ronda actual';
  end if;

  select max_non_critical_bad into v_maxbad from public.organizations where id=v_org;
  select * into v_ver from public.checklist_versions where organization_id=v_org and active limit 1;

  -- Recorrer respuestas y calcular severidades / conteos / razones de bloqueo.
  for v_elem in select * from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb)) loop
    v_type := (v_elem->>'item_type')::app.item_type;
    v_sev  := app.severity_of(v_type, v_elem->>'value');
    if v_sev is null then continue; end if;
    v_total := v_total + 1;
    v_name := coalesce(v_elem->>'item_name','');
    v_item_id := nullif(v_elem->>'item_id','')::uuid;

    -- Criticidad EXPLÍCITA desde el checklist (no matching por texto).
    v_crit := false;
    if v_item_id is not null then
      select is_safety_critical into v_crit from public.checklist_items where id=v_item_id;
      v_crit := coalesce(v_crit,false);
    end if;

    if v_sev='ok' then v_ok := v_ok+1;
    elsif v_sev='warn' then v_warn := v_warn+1;
    else
      v_bad := v_bad+1;
      if v_crit then
        v_reasons := array_append(v_reasons, 'Falla crítica de seguridad: '||v_name);
      else
        v_noncrit_bad := v_noncrit_bad + 1;
      end if;
    end if;
  end loop;

  if v_noncrit_bad >= v_maxbad then
    v_reasons := array_append(v_reasons,
      v_noncrit_bad||' fallas en estado "Malo" (límite: '||v_maxbad||')');
  end if;

  v_authorized := (array_length(v_reasons,1) is null);

  if v_bad=0 and v_warn=0 then v_result := 'bueno';
  elsif not v_authorized then v_result := 'malo';
  elsif v_bad>0 then v_result := 'malo';
  else v_result := 'regular';
  end if;

  -- Crear/actualizar la inspección (reutiliza el borrador si existe).
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
    where id=v_existing.id
    returning id into v_insp_id;
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

  -- Materializar respuestas + crear novedades para ítems marcados (bad/warn).
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

  -- NO AUTORIZADO -> bloqueo administrativo automático del vehículo.
  if not v_authorized then
    update public.vehicles set admin_blocked=true,
      admin_block_reason='NO AUTORIZADO: '||array_to_string(v_reasons,'; '),
      blocked_at=now(), blocked_by=v_uid
    where id=p_vehicle_id;
  end if;

  perform app.write_audit('inspection_submitted','inspection', v_insp_id::text, null,
    jsonb_build_object('authorized',v_authorized,'result',v_result,'reasons',to_jsonb(v_reasons)),
    jsonb_build_object('vehicle',v_veh.plate,'round',v_round.round_number));

  return jsonb_build_object('id',v_insp_id,'authorized',v_authorized,'result',v_result,
    'status',(case when v_authorized then 'authorized' else 'rejected' end),
    'reasons',to_jsonb(v_reasons),'ok',v_ok,'warn',v_warn,'bad',v_bad,'idempotent',false);
exception
  when unique_violation then
    -- Otro envío ganó la carrera; devolver la inspección existente.
    select * into v_existing from public.inspections
      where vehicle_id=p_vehicle_id and round_id=v_round.id
        and status in ('submitted','authorized','rejected','closed') and released=false
      limit 1;
    return jsonb_build_object('id', v_existing.id, 'authorized', v_existing.authorized,
      'result', v_existing.result, 'status', v_existing.status,
      'reasons', v_existing.auth_reasons, 'idempotent', true);
end;
$$;

-- Registrar regreso (cierra la operación abierta).
create or replace function public.register_return(
  p_inspection_id uuid, p_km_final int, p_fuel_out text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid; v_insp public.inspections;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin')
    then raise exception 'No autorizado'; end if;
  select * into v_insp from public.inspections
    where id=p_inspection_id and organization_id=v_org for update;
  if not found then raise exception 'Inspección no encontrada'; end if;
  if v_insp.operation_status <> 'open' then raise exception 'La operación no está abierta'; end if;
  if v_insp.km_inicial is not null and p_km_final is not null and p_km_final < v_insp.km_inicial then
    raise exception 'El kilometraje final no puede ser menor al inicial';
  end if;
  update public.inspections set km_final=p_km_final, fuel_out=p_fuel_out,
    operation_status='closed', status='closed', closed_at=now()
  where id=p_inspection_id;
  perform app.write_audit('operation_closed','inspection',p_inspection_id::text,
    jsonb_build_object('km_inicial',v_insp.km_inicial),
    jsonb_build_object('km_final',p_km_final,'fuel_out',p_fuel_out), null);
  return jsonb_build_object('id',p_inspection_id,'status','closed',
    'recorrido', p_km_final - coalesce(v_insp.km_inicial,0));
end;
$$;

-- Bloqueo/desbloqueo administrativo del vehículo (auditable).
create or replace function public.set_vehicle_block(
  p_vehicle_id uuid, p_blocked boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid; v_veh public.vehicles;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin')
    then raise exception 'No autorizado'; end if;
  select * into v_veh from public.vehicles where id=p_vehicle_id and organization_id=v_org for update;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  update public.vehicles set admin_blocked=p_blocked,
    admin_block_reason=(case when p_blocked then coalesce(p_reason,'') else '' end),
    blocked_at=(case when p_blocked then now() else null end),
    blocked_by=(case when p_blocked then auth.uid() else null end)
  where id=p_vehicle_id;
  perform app.write_audit(case when p_blocked then 'vehicle_blocked' else 'vehicle_unblocked' end,
    'vehicle', p_vehicle_id::text,
    jsonb_build_object('admin_blocked',v_veh.admin_blocked,'reason',v_veh.admin_block_reason),
    jsonb_build_object('admin_blocked',p_blocked,'reason',p_reason), null);
end;
$$;

-- Override administrativo de autorización (operación explícita y auditable).
create or replace function public.override_authorization(
  p_inspection_id uuid, p_authorize boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid; v_insp public.inspections;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin')
    then raise exception 'No autorizado'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'El motivo del override es obligatorio';
  end if;
  select * into v_insp from public.inspections
    where id=p_inspection_id and organization_id=v_org for update;
  if not found then raise exception 'Inspección no encontrada'; end if;

  if p_authorize then
    update public.inspections set authorized=true, status='authorized',
      operation_status='open', authorized_at=now(),
      auth_reasons = auth_reasons || jsonb_build_object('override', p_reason)
    where id=p_inspection_id;
    update public.vehicles set admin_blocked=false, admin_block_reason='',
      blocked_at=null, blocked_by=null where id=v_insp.vehicle_id;
  else
    update public.inspections set authorized=false, status='rejected',
      operation_status='none' where id=p_inspection_id;
    update public.vehicles set admin_blocked=true,
      admin_block_reason='Override administrativo: '||p_reason, blocked_at=now(), blocked_by=auth.uid()
    where id=v_insp.vehicle_id;
  end if;

  perform app.write_audit('override_authorization','inspection',p_inspection_id::text,
    jsonb_build_object('authorized',v_insp.authorized,'status',v_insp.status),
    jsonb_build_object('authorized',p_authorize,'reason',p_reason),
    jsonb_build_object('vehicle',v_insp.vehicle_plate));
  return jsonb_build_object('id',p_inspection_id,'authorized',p_authorize);
end;
$$;

-- Ciclo de vida de novedades.
create or replace function public.set_issue_status(
  p_issue_id uuid, p_status app.issue_status, p_note text)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid; v_iss public.issues;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','maintenance','superadmin')
    then raise exception 'No autorizado'; end if;
  select * into v_iss from public.issues where id=p_issue_id and organization_id=v_org for update;
  if not found then raise exception 'Novedad no encontrada'; end if;
  update public.issues set status=p_status,
    resolution_note=coalesce(p_note, resolution_note),
    resolved_at=(case when p_status='resolved' then now() else resolved_at end),
    resolved_by=(case when p_status='resolved' then auth.uid() else resolved_by end),
    reopened_at=(case when p_status='reopened' then now() else reopened_at end)
  where id=p_issue_id;
  perform app.write_audit('issue_status_changed','issue',p_issue_id::text,
    jsonb_build_object('status',v_iss.status),
    jsonb_build_object('status',p_status,'note',p_note),
    jsonb_build_object('vehicle_id',v_iss.vehicle_id,'item',v_iss.item_name));
end;
$$;

-- Anular inspección (deja de contar en reportes).
create or replace function public.void_inspection(p_inspection_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid; v_insp public.inspections;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then raise exception 'No autorizado'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Motivo obligatorio'; end if;
  select * into v_insp from public.inspections where id=p_inspection_id and organization_id=v_org for update;
  if not found then raise exception 'Inspección no encontrada'; end if;
  update public.inspections set status='voided', operation_status='none',
    void_reason=p_reason, voided_by=auth.uid(), voided_at=now() where id=p_inspection_id;
  perform app.write_audit('inspection_voided','inspection',p_inspection_id::text,
    to_jsonb(v_insp.status), jsonb_build_object('reason',p_reason), null);
end;
$$;

-- Liberar vehículo para nueva inspección en la ronda (conserva el histórico).
create or replace function public.release_inspection(p_inspection_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then raise exception 'No autorizado'; end if;
  update public.inspections set released=true
    where id=p_inspection_id and organization_id=v_org;
  perform app.write_audit('inspection_released','inspection',p_inspection_id::text,null,null,null);
end;
$$;

-- Rondas: abrir una nueva (cierra la abierta). Serializado por organización.
create or replace function public.start_round(p_label text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid; v_num int; v_id uuid; v_label text;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then raise exception 'No autorizado'; end if;
  perform pg_advisory_xact_lock(hashtext('round:'||v_org::text));
  update public.rounds set status='closed', closed_at=now(), closed_by=auth.uid()
    where organization_id=v_org and status='open';
  select coalesce(max(round_number),0)+1 into v_num from public.rounds where organization_id=v_org;
  v_label := coalesce(nullif(trim(p_label),''), 'Ronda '||v_num);
  insert into public.rounds(organization_id, round_number, label, status, started_by)
    values (v_org, v_num, v_label, 'open', auth.uid()) returning id into v_id;
  perform app.write_audit('round_started','round',v_id::text,null,
    jsonb_build_object('round_number',v_num,'label',v_label),null);
  return jsonb_build_object('id',v_id,'round_number',v_num,'label',v_label);
end;
$$;

create or replace function public.close_round()
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then raise exception 'No autorizado'; end if;
  update public.rounds set status='closed', closed_at=now(), closed_by=auth.uid()
    where organization_id=v_org and status='open';
  perform app.write_audit('round_closed','round',null,null,null,null);
end;
$$;

-- Publicar nueva versión de checklist (snapshot inmutable de lo activo).
create or replace function public.publish_checklist_version(p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare v_org uuid; v_num int; v_struct jsonb; v_id uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then raise exception 'No autorizado'; end if;
  perform pg_advisory_xact_lock(hashtext('checklist:'||v_org::text));
  select jsonb_agg(cat order by cat_order) into v_struct from (
    select c.sort_order as cat_order, jsonb_build_object(
      'key',c.key,'name',c.name,'icon',c.icon,'sort_order',c.sort_order,
      'items',(select coalesce(jsonb_agg(jsonb_build_object(
                 'id',i.id,'name',i.name,'item_type',i.item_type,
                 'required',i.required,'is_safety_critical',i.is_safety_critical,
                 'sort_order',i.sort_order) order by i.sort_order),'[]'::jsonb)
               from public.checklist_items i where i.category_id=c.id and i.active)
    ) as cat
    from public.checklist_categories c where c.organization_id=v_org and c.active
  ) sub;
  select coalesce(max(version_number),0)+1 into v_num from public.checklist_versions where organization_id=v_org;
  update public.checklist_versions set active=false where organization_id=v_org and active;
  insert into public.checklist_versions(organization_id, version_number, structure, active, note, created_by)
    values (v_org, v_num, coalesce(v_struct,'[]'::jsonb), true, coalesce(p_note,''), auth.uid())
    returning id into v_id;
  perform app.write_audit('checklist_published','checklist_version',v_id::text,null,
    jsonb_build_object('version_number',v_num,'note',p_note),null);
  return jsonb_build_object('id',v_id,'version_number',v_num);
end;
$$;

-- Conductores: crear (con PIN) y cambiar PIN (hash bcrypt, nunca en claro).
create or replace function public.admin_create_driver(
  p_full_name text, p_license text, p_whatsapp text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare v_org uuid; v_id uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then raise exception 'No autorizado'; end if;
  if p_pin is not null and p_pin !~ '^\d{4}$' then raise exception 'El PIN debe tener 4 dígitos'; end if;
  insert into public.drivers(organization_id, full_name, license, whatsapp, pin_hash, created_by)
    values (v_org, p_full_name, coalesce(p_license,''), coalesce(p_whatsapp,''),
      case when p_pin is not null then extensions.crypt(p_pin, extensions.gen_salt('bf')) else null end,
      auth.uid())
    returning id into v_id;
  perform app.write_audit('driver_created','driver',v_id::text,null,
    jsonb_build_object('full_name',p_full_name),null);
  return v_id;
end;
$$;

create or replace function public.set_driver_pin(p_driver_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, app, extensions, pg_temp
as $$
declare v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then raise exception 'No autorizado'; end if;
  if p_pin is null or p_pin !~ '^\d{4}$' then raise exception 'El PIN debe tener 4 dígitos'; end if;
  update public.drivers set pin_hash=extensions.crypt(p_pin, extensions.gen_salt('bf')), updated_at=now()
    where id=p_driver_id and organization_id=v_org;
  if not found then raise exception 'Conductor no encontrado'; end if;
  perform app.write_audit('driver_pin_changed','driver',p_driver_id::text,null,null,null);
end;
$$;

-- Permisos de ejecución.
grant execute on function
  public.app_bootstrap(),
  public.verify_driver_pin(uuid,text),
  public.save_inspection_draft(uuid,uuid,jsonb,int,text,text),
  public.submit_inspection(uuid,uuid,jsonb,int,text,text,text),
  public.register_return(uuid,int,text),
  public.set_vehicle_block(uuid,boolean,text),
  public.override_authorization(uuid,boolean,text),
  public.set_issue_status(uuid,app.issue_status,text),
  public.void_inspection(uuid,text),
  public.release_inspection(uuid),
  public.start_round(text),
  public.close_round(),
  public.publish_checklist_version(text),
  public.admin_create_driver(text,text,text,text),
  public.set_driver_pin(uuid,text)
to authenticated;
