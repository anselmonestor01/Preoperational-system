-- 0019 — Un conductor no puede iniciar otra inspección con un vehículo en ruta.
--
-- EL PROBLEMA
-- Al enviar una inspección autorizada, el vehículo queda "en ruta"
-- (operation_status = 'open') y la reserva del perfil se libera de inmediato.
-- Nada impedía que el mismo conductor volviera al kiosco y sacara un segundo
-- vehículo sin haber registrado el regreso del primero. El resultado: una
-- persona figurando conduciendo dos unidades a la vez, kilometrajes que nunca
-- cierran y vehículos que quedan bloqueados sin que nadie sepa por qué.
--
-- LA REGLA
-- Mientras un conductor tenga una salida abierta, no puede iniciar otra
-- inspección. Se comprueba en dos sitios:
--   · `claim_driver`  — al escribir el PIN, para avisar ANTES de que el
--     conductor rellene 50 ítems del checklist para nada.
--   · un disparador sobre `inspections` — al escribir. Ése es el control real:
--     vale para CUALQUIER vía que abra una operación, no sólo para
--     `submit_inspection`, y manipular el navegador no lo evita.
--
-- QUÉ NO BLOQUEA
--   · Registrar el regreso: ese flujo no pasa por `claim_driver`.
--   · Una inspección RECHAZADA no abre operación (operation_status = 'none'),
--     así que no deja al conductor bloqueado.
--   · Reenviar la misma inspección desde la cola sin señal: la idempotencia se
--     resuelve antes de esta validación.
--
-- SALIDA DE EMERGENCIA
-- Si un vehículo nunca regresa (equipo perdido, salida registrada por error),
-- el administrador anula la inspección desde el panel: `void_inspection` deja
-- operation_status en 'none' y libera al conductor.

-- ---------------------------------------------------------------------------
-- Operación abierta de un conductor, si la tiene.
-- ---------------------------------------------------------------------------
create or replace function app.open_operation_of_driver(
  p_driver_id uuid,
  p_org uuid
) returns public.inspections
language sql stable security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
  select *
  from public.inspections
  where organization_id = p_org
    and driver_id = p_driver_id
    and operation_status = 'open'
    and status <> 'voided'
  order by submitted_at desc nulls last
  limit 1;
$$;

comment on function app.open_operation_of_driver(uuid, uuid) is
  'Salida sin regreso registrado de un conductor. Base de la regla que impide '
  'que la misma persona figure conduciendo dos vehículos a la vez.';

-- ---------------------------------------------------------------------------
-- claim_driver: avisar al escribir el PIN, no al final del checklist.
-- ---------------------------------------------------------------------------
create or replace function public.claim_driver(
  p_driver_id uuid, p_pin text, p_device_id text, p_device_label text default null)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
declare
  v_org uuid; v_hash text; v_name text; v_claim public.driver_claims;
  v_abierta public.inspections;
  v_ttl interval := interval '45 minutes';
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin') then
    raise exception 'No autorizado';
  end if;
  if coalesce(btrim(p_device_id),'') = '' then
    raise exception 'Falta identificar el dispositivo';
  end if;

  select pin_hash, full_name into v_hash, v_name
  from public.drivers
  where id = p_driver_id and organization_id = v_org and active
  for update;
  if not found then raise exception 'Conductor no encontrado'; end if;

  -- El PIN se compara contra el hash; nunca se guarda ni se devuelve en claro.
  if v_hash is null or v_hash <> extensions.crypt(p_pin, v_hash) then
    return jsonb_build_object('ok', false, 'motivo', 'pin');
  end if;

  -- Vehículo en ruta sin regreso registrado: se avisa aquí, antes de que el
  -- conductor haga todo el checklist para que se lo rechacen al enviarlo.
  v_abierta := app.open_operation_of_driver(p_driver_id, v_org);
  if v_abierta.id is not null then
    return jsonb_build_object(
      'ok', false, 'motivo', 'en_ruta',
      'placa', v_abierta.vehicle_plate,
      'desde', v_abierta.submitted_at);
  end if;

  -- Limpieza de reservas caducadas (un turno que nunca cerró no bloquea para siempre).
  delete from public.driver_claims where expires_at < now();

  select * into v_claim from public.driver_claims where driver_id = p_driver_id;

  if found and v_claim.device_id <> p_device_id then
    return jsonb_build_object(
      'ok', false, 'motivo', 'en_uso',
      'desde', v_claim.claimed_at,
      'dispositivo', coalesce(v_claim.device_label, 'otro dispositivo'));
  end if;

  insert into public.driver_claims(driver_id, organization_id, device_id, device_label, claimed_at, expires_at)
    values (p_driver_id, v_org, p_device_id, p_device_label, now(), now() + v_ttl)
  on conflict (driver_id) do update
    set device_id = excluded.device_id,
        device_label = excluded.device_label,
        claimed_at = now(),
        expires_at = now() + v_ttl;

  return jsonb_build_object('ok', true, 'nombre', v_name);
end; $$;

revoke all on function public.claim_driver(uuid, text, text, text) from public;
grant execute on function public.claim_driver(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- El control obligatorio: disparador sobre la tabla.
-- ---------------------------------------------------------------------------
-- Se pone aquí y no dentro de `submit_inspection` a propósito: así la regla
-- protege cualquier camino que deje una inspección "en ruta", hoy y en el
-- futuro, sin depender de que alguien recuerde repetir la comprobación.

create or replace function app.una_operacion_por_conductor()
returns trigger
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_otra public.inspections;
begin
  -- Sólo interesa el momento en que una inspección PASA a estar en ruta.
  if new.operation_status <> 'open' or new.driver_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.operation_status = 'open'
     and old.driver_id is not distinct from new.driver_id then
    return new;   -- ya estaba abierta con el mismo conductor: no es una salida nueva
  end if;

  select * into v_otra
  from public.inspections
  where organization_id = new.organization_id
    and driver_id = new.driver_id
    and operation_status = 'open'
    and status <> 'voided'
    and id <> new.id
  limit 1;

  if found then
    raise exception
      'Este conductor tiene el vehículo % en ruta desde las %. Debe registrar el regreso antes de iniciar otra inspección.',
      coalesce(v_otra.vehicle_plate, 'asignado'),
      to_char(timezone('America/Bogota',
              coalesce(v_otra.submitted_at, v_otra.created_at)), 'HH12:MI AM');
  end if;

  return new;
end; $$;

comment on function app.una_operacion_por_conductor() is
  'Impide que un conductor tenga dos vehículos en ruta a la vez. Un administrador '
  'puede liberarlo anulando la inspección (void_inspection deja operation_status en none).';

drop trigger if exists trg_una_operacion_por_conductor on public.inspections;
create trigger trg_una_operacion_por_conductor
  before insert or update on public.inspections
  for each row execute function app.una_operacion_por_conductor();
