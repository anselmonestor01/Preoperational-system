-- =============================================================================
-- PREOPERATIONAL SYSTEM — Migración 0011
-- Depuración de historial: renombrar y eliminar rondas, y eliminar inspecciones
-- por completo (respuestas, novedades y evidencias incluidas).
--
-- Pensado para limpiar datos de PRUEBA sin dejar rastro parcial: si una ronda
-- queda sin inspecciones tras la depuración, la ronda se elimina también, de
-- modo que el historial vuelve al estado "como si nunca hubiera existido".
--
-- Toda eliminación exige la CONTRASEÑA del administrador que la ejecuta y queda
-- registrada en audit_logs (los audit_logs NO se borran: son la bitácora de que
-- la depuración ocurrió, y sin ellos no habría trazabilidad de quién borró qué).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Verificación de la contraseña del usuario autenticado.
-- Devuelve sólo un booleano: nunca expone el hash. Es SECURITY DEFINER porque
-- auth.users no es legible por el rol `authenticated`.
-- ---------------------------------------------------------------------------
create or replace function app.verify_admin_password(p_password text)
returns boolean language plpgsql security definer
set search_path = public, app, extensions, pg_temp as $$
declare v_hash text;
begin
  if auth.uid() is null or p_password is null or p_password = '' then
    return false;
  end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if v_hash is null then return false; end if;
  return v_hash = extensions.crypt(p_password, v_hash);
end; $$;

revoke execute on function app.verify_admin_password(text) from public, anon;
grant execute on function app.verify_admin_password(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Renombrar una ronda (no destructivo: no toca inspecciones).
-- ---------------------------------------------------------------------------
create or replace function public.rename_round(p_round_id uuid, p_label text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare v_org uuid; v_old text; v_new text;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then
    raise exception 'No autorizado';
  end if;

  v_new := btrim(coalesce(p_label, ''));
  if v_new = '' then raise exception 'El nombre de la ronda no puede estar vacío'; end if;

  select label into v_old from public.rounds
    where id = p_round_id and organization_id = v_org for update;
  if not found then raise exception 'Ronda no encontrada'; end if;

  update public.rounds set label = v_new where id = p_round_id;

  perform app.write_audit('round_renamed','round',p_round_id::text,
    jsonb_build_object('label',v_old), jsonb_build_object('label',v_new), null);

  return jsonb_build_object('id',p_round_id,'label',v_new);
end; $$;

-- ---------------------------------------------------------------------------
-- Eliminar UNA inspección con todo su rastro.
-- Devuelve las rutas de Storage a borrar (Storage no se puede tocar por SQL) y
-- si la ronda quedó vacía, la elimina y lo informa.
-- ---------------------------------------------------------------------------
create or replace function public.delete_inspection(p_inspection_id uuid, p_password text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare
  v_org uuid; v_insp public.inspections;
  v_paths text[] := '{}';
  v_round_id uuid; v_round_label text; v_round_deleted boolean := false; v_left int;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then
    raise exception 'No autorizado';
  end if;
  if not app.verify_admin_password(p_password) then
    raise exception 'La contraseña no es correcta';
  end if;

  select * into v_insp from public.inspections
    where id = p_inspection_id and organization_id = v_org for update;
  if not found then raise exception 'Inspección no encontrada'; end if;

  v_round_id := v_insp.round_id;

  -- Rutas de evidencia antes de borrar las filas (el cliente borra los archivos).
  select coalesce(array_agg(storage_path), '{}') into v_paths
  from public.issue_evidence
  where organization_id = v_org
    and (inspection_id = p_inspection_id
         or issue_id in (select id from public.issues where inspection_id = p_inspection_id));

  delete from public.issue_evidence
    where organization_id = v_org
      and (inspection_id = p_inspection_id
           or issue_id in (select id from public.issues where inspection_id = p_inspection_id));
  delete from public.issues where inspection_id = p_inspection_id and organization_id = v_org;
  delete from public.inspection_answers where inspection_id = p_inspection_id;
  delete from public.inspections where id = p_inspection_id and organization_id = v_org;

  -- Si la ronda se quedó sin inspecciones, desaparece: el historial queda limpio.
  if v_round_id is not null then
    select count(*) into v_left from public.inspections where round_id = v_round_id;
    if v_left = 0 then
      select label into v_round_label from public.rounds where id = v_round_id and organization_id = v_org;
      delete from public.rounds where id = v_round_id and organization_id = v_org;
      v_round_deleted := found;
    end if;
  end if;

  perform app.write_audit('inspection_deleted','inspection',p_inspection_id::text,
    jsonb_build_object('vehicle',v_insp.vehicle_plate,'driver',v_insp.driver_name,
                       'submitted_at',v_insp.submitted_at),
    jsonb_build_object('round_deleted',v_round_deleted,'round_label',v_round_label), null);

  return jsonb_build_object(
    'id', p_inspection_id,
    'storage_paths', to_jsonb(v_paths),
    'round_deleted', v_round_deleted,
    'round_label', v_round_label
  );
end; $$;

-- ---------------------------------------------------------------------------
-- Eliminar una RONDA COMPLETA con todas sus inspecciones y su rastro.
-- ---------------------------------------------------------------------------
create or replace function public.delete_round(p_round_id uuid, p_password text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare
  v_org uuid; v_label text; v_paths text[] := '{}'; v_count int;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then
    raise exception 'No autorizado';
  end if;
  if not app.verify_admin_password(p_password) then
    raise exception 'La contraseña no es correcta';
  end if;

  select label into v_label from public.rounds
    where id = p_round_id and organization_id = v_org for update;
  if not found then raise exception 'Ronda no encontrada'; end if;

  select count(*) into v_count from public.inspections
    where round_id = p_round_id and organization_id = v_org;

  select coalesce(array_agg(storage_path), '{}') into v_paths
  from public.issue_evidence
  where organization_id = v_org
    and (inspection_id in (select id from public.inspections where round_id = p_round_id)
         or issue_id in (select id from public.issues
                         where inspection_id in (select id from public.inspections where round_id = p_round_id)));

  delete from public.issue_evidence
    where organization_id = v_org
      and (inspection_id in (select id from public.inspections where round_id = p_round_id)
           or issue_id in (select id from public.issues
                           where inspection_id in (select id from public.inspections where round_id = p_round_id)));
  delete from public.issues
    where organization_id = v_org
      and inspection_id in (select id from public.inspections where round_id = p_round_id);
  delete from public.inspection_answers
    where inspection_id in (select id from public.inspections where round_id = p_round_id);
  delete from public.inspections where round_id = p_round_id and organization_id = v_org;
  delete from public.rounds where id = p_round_id and organization_id = v_org;

  perform app.write_audit('round_deleted','round',p_round_id::text,
    jsonb_build_object('label',v_label,'inspections',v_count), null, null);

  return jsonb_build_object(
    'id', p_round_id, 'label', v_label,
    'inspections_deleted', v_count,
    'storage_paths', to_jsonb(v_paths)
  );
end; $$;

revoke execute on function public.rename_round(uuid,text) from public, anon;
revoke execute on function public.delete_inspection(uuid,text) from public, anon;
revoke execute on function public.delete_round(uuid,text) from public, anon;
grant execute on function public.rename_round(uuid,text) to authenticated;
grant execute on function public.delete_inspection(uuid,text) to authenticated;
grant execute on function public.delete_round(uuid,text) to authenticated;
