-- =============================================================================
-- MUNDO MARÍTIMO — Migración 0008 (FASE 2)
-- Eliminación de vehículos y conductores: archivar (seguro) o borrado físico.
-- Preserva integridad referencial. Auditable.
-- =============================================================================

-- delete_vehicle: p_mode 'archive' (conserva historial) | 'hard' (borra todo).
create or replace function public.delete_vehicle(p_vehicle_id uuid, p_mode text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare v_org uuid; v_veh public.vehicles;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then raise exception 'No autorizado'; end if;
  select * into v_veh from public.vehicles where id=p_vehicle_id and organization_id=v_org for update;
  if not found then raise exception 'Vehículo no encontrado'; end if;

  if p_mode = 'hard' then
    -- Borrado físico controlado: evidencias, respuestas, novedades, inspecciones, vehículo.
    delete from public.issue_evidence
      where organization_id=v_org
        and (inspection_id in (select id from public.inspections where vehicle_id=p_vehicle_id)
             or issue_id in (select id from public.issues where vehicle_id=p_vehicle_id));
    delete from public.inspection_answers
      where inspection_id in (select id from public.inspections where vehicle_id=p_vehicle_id);
    delete from public.issues where vehicle_id=p_vehicle_id and organization_id=v_org;
    delete from public.inspections where vehicle_id=p_vehicle_id and organization_id=v_org;
    delete from public.vehicles where id=p_vehicle_id and organization_id=v_org;
    perform app.write_audit('vehicle_deleted','vehicle',p_vehicle_id::text,
      jsonb_build_object('plate',v_veh.plate), jsonb_build_object('mode','hard'), null);
    return jsonb_build_object('id',p_vehicle_id,'mode','hard');
  else
    update public.vehicles set status='archived', admin_blocked=false, admin_block_reason='',
      blocked_at=null, blocked_by=null where id=p_vehicle_id;
    perform app.write_audit('vehicle_archived','vehicle',p_vehicle_id::text,
      jsonb_build_object('plate',v_veh.plate), jsonb_build_object('mode','archive'), null);
    return jsonb_build_object('id',p_vehicle_id,'mode','archive');
  end if;
end; $$;

-- delete_driver: 'archive' (active=false) | 'hard' (borra; historial conserva driver_name).
create or replace function public.delete_driver(p_driver_id uuid, p_mode text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare v_org uuid; v_drv public.drivers;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then raise exception 'No autorizado'; end if;
  select * into v_drv from public.drivers where id=p_driver_id and organization_id=v_org for update;
  if not found then raise exception 'Conductor no encontrado'; end if;

  if p_mode = 'hard' then
    -- Las FKs de inspections/issues son ON DELETE SET NULL: el historial conserva
    -- driver_name congelado. Si el conductor tenía perfil de app, se desactiva.
    if v_drv.profile_id is not null then
      update public.profiles set active=false where id=v_drv.profile_id and organization_id=v_org;
    end if;
    delete from public.drivers where id=p_driver_id and organization_id=v_org;
    perform app.write_audit('driver_deleted','driver',p_driver_id::text,
      jsonb_build_object('name',v_drv.full_name), jsonb_build_object('mode','hard'), null);
    return jsonb_build_object('id',p_driver_id,'mode','hard');
  else
    update public.drivers set active=false where id=p_driver_id;
    perform app.write_audit('driver_archived','driver',p_driver_id::text,
      jsonb_build_object('name',v_drv.full_name), jsonb_build_object('mode','archive'), null);
    return jsonb_build_object('id',p_driver_id,'mode','archive');
  end if;
end; $$;

revoke execute on function public.delete_vehicle(uuid,text) from public, anon;
revoke execute on function public.delete_driver(uuid,text) from public, anon;
grant execute on function public.delete_vehicle(uuid,text) to authenticated;
grant execute on function public.delete_driver(uuid,text) to authenticated;
