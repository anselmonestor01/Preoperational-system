-- 0028 — El mismo patrón, buscado en el resto del sistema.
-- =============================================================================
-- La migración 0027 arregla el ciclo salida → operación → regreso. Este archivo
-- es el resultado de la pregunta obligada después de cualquier arreglo: ¿dónde
-- MÁS se repite el patrón? El patrón era doble:
--
--   (a) cambiar `operation_status` sin comprobar desde qué estado se venía, y
--   (b) declarar un vehículo o un perfil disponible sin mirar si su operación
--       seguía abierta.
--
-- Aparece en tres funciones de administración. Ninguna de las tres es
-- alcanzable desde el kiosco, así que la gravedad es menor —hace falta ser
-- administrador— pero un administrador se equivoca igual que cualquiera, y el
-- panel no debería permitir dejar la flota en un estado imposible.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. override_authorization — no puede resucitar una operación terminada.
-- ---------------------------------------------------------------------------
-- ANTES: ponía `operation_status='open'` sobre CUALQUIER inspección, incluida
-- una ya cerrada con su kilometraje final registrado. El resultado era una
-- operación "en ruta" que ya había vuelto, con km_final relleno y closed_at en
-- el pasado: un estado que ninguna consulta del panel sabe interpretar.
--
-- AHORA: el override sigue siendo la herramienta para corregir un veredicto
-- del sistema, pero sólo sobre una inspección viva. Para una operación cerrada
-- existe el historial; para una anulada, la anulación es definitiva.
create or replace function public.override_authorization(
  p_inspection_id uuid, p_authorize boolean, p_reason text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_org uuid; v_insp public.inspections;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then raise exception 'No autorizado'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'El motivo del override es obligatorio'; end if;

  select * into v_insp from public.inspections where id=p_inspection_id and organization_id=v_org for update;
  if not found then raise exception 'Inspección no encontrada'; end if;

  -- La máquina de estados, explícita.
  if v_insp.status = 'voided' then
    raise exception 'La inspección está anulada: el veredicto ya no se puede cambiar.';
  end if;
  if v_insp.status = 'closed' or v_insp.operation_status = 'closed' then
    raise exception 'La operación ya se cerró con su regreso registrado. Cambiar ahora el veredicto dejaría el vehículo figurando en ruta después de haber vuelto.';
  end if;

  if p_authorize then
    -- Cerrojo sobre el conductor antes de abrirle una operación, por el mismo
    -- motivo que en submit_inspection: comprobar sin cerrojo es comprobar en
    -- vano. El disparador y el índice único vuelven a validarlo detrás.
    if v_insp.driver_id is not null then
      perform pg_advisory_xact_lock(hashtext('conductor:' || v_insp.driver_id::text));
    end if;

    update public.inspections set authorized=true, status='authorized',
      operation_status='open', authorized_at=now(),
      auth_reasons = auth_reasons || jsonb_build_object('override', p_reason) where id=p_inspection_id;

    -- Sólo se levanta el bloqueo si lo puso un override anterior. Un bloqueo
    -- puesto a mano por mantenimiento no es asunto de esta función.
    update public.vehicles set admin_blocked=false, admin_block_reason='',
      blocked_at=null, blocked_by=null
    where id=v_insp.vehicle_id
      and admin_blocked
      and admin_block_reason like 'Override administrativo:%';
  else
    update public.inspections set authorized=false, status='rejected',
      operation_status='none' where id=p_inspection_id;
    update public.vehicles set admin_blocked=true,
      admin_block_reason='Override administrativo: '||p_reason, blocked_at=now(), blocked_by=auth.uid()
    where id=v_insp.vehicle_id;
    -- Rechazada: el perfil del conductor queda libre de inmediato.
    delete from public.driver_claims where driver_id = v_insp.driver_id and organization_id = v_org;
  end if;

  perform app.write_audit('override_authorization','inspection',p_inspection_id::text,
    jsonb_build_object('authorized',v_insp.authorized,'status',v_insp.status),
    jsonb_build_object('authorized',p_authorize,'reason',p_reason),
    jsonb_build_object('vehicle',v_insp.vehicle_plate));
  return jsonb_build_object('id',p_inspection_id,'authorized',p_authorize);
end; $$;

revoke all on function public.override_authorization(uuid, boolean, text) from public, anon;
grant execute on function public.override_authorization(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. release_inspection — no se libera un vehículo que sigue en ruta.
-- ---------------------------------------------------------------------------
-- ANTES: `update inspections set released=true`, sin más. Un administrador
-- podía declarar disponible un vehículo cuya operación seguía abierta. El
-- vehículo aparecía libre en el kiosco, un segundo conductor lo tomaba, y la
-- flota quedaba con dos personas en la misma unidad — exactamente el estado
-- que todo lo demás intenta evitar.
--
-- AHORA: para liberar un vehículo en ruta hay que cerrar su operación primero.
-- Si el regreso no se puede registrar de la forma normal, está
-- `force_close_operation`, que deja constancia del motivo.
create or replace function public.release_inspection(p_inspection_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_org uuid; v_insp public.inspections;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then raise exception 'No autorizado'; end if;

  select * into v_insp from public.inspections
    where id=p_inspection_id and organization_id=v_org for update;
  if not found then raise exception 'Inspección no encontrada'; end if;

  if v_insp.operation_status = 'open' then
    raise exception
      'El vehículo % sigue en ruta con % desde las %. Cierra primero la operación: liberarlo ahora lo pondría disponible para un segundo conductor.',
      coalesce(v_insp.vehicle_plate,'asignado'),
      coalesce(v_insp.driver_name,'su conductor'),
      to_char(timezone('America/Bogota', coalesce(v_insp.submitted_at, v_insp.created_at)), 'HH12:MI AM');
  end if;

  update public.inspections set released=true where id=p_inspection_id and organization_id=v_org;
  perform app.write_audit('inspection_released','inspection',p_inspection_id::text,null,null,null);
end; $$;

revoke all on function public.release_inspection(uuid) from public, anon;
grant execute on function public.release_inspection(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. delete_inspection — al borrar la operación, se borra su reserva.
-- ---------------------------------------------------------------------------
-- Borrar una inspección con operación abierta hacía desaparecer la salida pero
-- dejaba viva la reserva del perfil, que ya no apuntaba a nada. El conductor
-- se quedaba con el perfil ocupado por una operación inexistente hasta que la
-- reserva caducara. Se limpia dentro de la misma transacción.
create or replace function public.delete_inspection(p_inspection_id uuid, p_password text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
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

  -- La reserva del perfil sólo tenía sentido mientras la operación existiera.
  if v_insp.operation_status = 'open' and v_insp.driver_id is not null then
    delete from public.driver_claims
     where driver_id = v_insp.driver_id and organization_id = v_org;
  end if;

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

revoke all on function public.delete_inspection(uuid, text) from public, anon;
grant execute on function public.delete_inspection(uuid, text) to authenticated;
