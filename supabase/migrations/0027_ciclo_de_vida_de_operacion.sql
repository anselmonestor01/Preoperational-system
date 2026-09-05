-- 0027 — El ciclo salida → operación → regreso deja de ser una convención
--        y pasa a ser un invariante que el motor de datos garantiza.
-- =============================================================================
--
-- QUÉ SE ENCONTRÓ (auditoría forense sobre datos reales, ronda 1 del 05/09)
--
--   · Un mismo perfil de conductor ejecutó 5 inspecciones en una sola ronda
--     sobre 4 vehículos distintos (00:16:42 → 00:52:00).
--   · Operaciones físicamente imposibles: 10 s de ruta con 101.111 km
--     recorridos; 21 s con 9.000 km; 69 s con 91.112 km.
--   · El odómetro de ZZZ-001 retrocedió dos veces: 10.000 → 1.000 km y
--     11.233 → 10.000 km. Nada lo impedía.
--   · Cuatro borradores huérfanos creados en el MISMO segundo en que se
--     enviaba su inspección hermana, sin dispositivo asociado.
--   · Una operación abierta sin ninguna reserva de perfil viva: la reserva
--     caducaba (o se borraba) mientras el vehículo seguía en ruta.
--
-- POR QUÉ PASÓ (causa raíz, no síntoma)
--
--   La regla "un conductor, una operación" existía sólo como comprobación
--   dentro de un disparador: SELECT … LIMIT 1 y, si no hay filas, adelante.
--   Eso es un "comprobar y luego actuar" SIN CERROJO. Bajo READ COMMITTED dos
--   transacciones simultáneas leen ambas cero filas y ambas escriben. No había
--   ningún índice único que hiciera imposible el resultado prohibido.
--
--   Y el ciclo de vida no tenía invariantes: `register_return` cerraba la
--   operación, marcaba el vehículo como liberado y borraba la reserva del
--   perfil EN EL MISMO INSTANTE, sin exigir que hubiera transcurrido una
--   operación plausible. De ahí la "reutilización inmediata".
--
-- DÓNDE SE ARREGLA
--
--   En el motor de datos, no en la interfaz. Tres capas, de dentro hacia fuera:
--
--   1. ÍNDICES ÚNICOS PARCIALES — la garantía dura. Ninguna vía de escritura,
--      ni concurrencia, ni SQL directo, puede dejar dos operaciones abiertas
--      del mismo conductor o del mismo vehículo. Es el motor quien lo impide.
--   2. CERROJOS DE AVISO por conductor — serializan las transacciones que
--      compiten por el mismo perfil para que el error sea uno legible en
--      castellano y no una violación de índice en crudo.
--   3. INVARIANTES DE CICLO en `register_return` — permanencia mínima
--      (política, ajustable por empresa) y plausibilidad física (continuidad
--      del odómetro, distancia máxima y velocidad media implícita).
--
-- Se distingue a propósito POLÍTICA de FÍSICA: la permanencia mínima es una
-- decisión de negocio que cada empresa ajusta; el odómetro que retrocede o los
-- 1.735.000 km/h son datos imposibles y no se negocian.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Parámetros del ciclo de vida, por empresa.
-- ---------------------------------------------------------------------------
-- Van en `organizations` y no en el código porque una flota de patio y una de
-- carretera no tienen la misma noción de "operación demasiado corta".
alter table public.organizations
  add column if not exists min_operacion_segundos int  not null default 300,
  add column if not exists max_km_operacion       int  not null default 2000,
  add column if not exists max_kmh_operacion      int  not null default 120;

alter table public.organizations
  drop constraint if exists chk_org_min_operacion,
  add  constraint chk_org_min_operacion
    check (min_operacion_segundos between 0 and 86400),
  drop constraint if exists chk_org_max_km_operacion,
  add  constraint chk_org_max_km_operacion
    check (max_km_operacion between 1 and 9999999),
  drop constraint if exists chk_org_max_kmh_operacion,
  add  constraint chk_org_max_kmh_operacion
    check (max_kmh_operacion between 1 and 400);

comment on column public.organizations.min_operacion_segundos is
  'Permanencia mínima entre la salida y el regreso. POLÍTICA, no física: cada '
  'empresa la ajusta. Cero la desactiva. Un administrador siempre puede cerrar '
  'antes con force_close_operation, dejando constancia del motivo.';
comment on column public.organizations.max_km_operacion is
  'Kilómetros máximos plausibles en una sola operación.';
comment on column public.organizations.max_kmh_operacion is
  'Velocidad media máxima plausible. Delata los 101.111 km en 210 segundos.';


-- ---------------------------------------------------------------------------
-- 2. Reparación de los borradores huérfanos ya existentes.
-- ---------------------------------------------------------------------------
-- ORIGEN: el kiosco autoguarda el borrador con un retardo de 1,5 s. Si el
-- conductor pulsa "Enviar" dentro de esa ventana, `submit_inspection` convierte
-- la fila `in_progress` en la inspección definitiva y el autoguardado que
-- llegaba tarde ya no encuentra fila que actualizar: INSERTA una nueva. De ahí
-- las filas creadas en el mismo segundo que su hermana y sin dispositivo.
--
-- LA FIRMA DEL HUÉRFANO, medida sobre los datos reales: la fila nace entre
-- 0,04 y 0,50 SEGUNDOS DESPUÉS de que su hermana definitiva se enviara, con el
-- mismo vehículo, la misma ronda, el mismo conductor y el mismo kilometraje
-- inicial. Nadie rellena un checklist en medio segundo: es un eco, no una
-- inspección nueva. Ese margen de cinco segundos es lo que se usa para
-- identificarlos, y antes de retirar cada fila se archiva entera.
--
-- No vale con "tiene una hermana": tras un regreso limpio el vehículo vuelve a
-- estar disponible en la misma ronda, así que un borrador legítimo puede
-- convivir perfectamente con una inspección cerrada del mismo vehículo.
create table if not exists app.borradores_huerfanos (
  id             uuid primary key,
  fila           jsonb not null,
  hermana_id     uuid,
  archivado_at   timestamptz not null default now()
);
comment on table app.borradores_huerfanos is
  'Copia íntegra de los borradores huérfanos retirados por la migración 0027. '
  'Existe para que la reparación sea reversible: no se destruye ningún dato.';

with huerfanos as (
  select b.id, to_jsonb(b) as fila, h.id as hermana_id
  from public.inspections b
  join lateral (
    select i.id from public.inspections i
    where i.vehicle_id = b.vehicle_id
      and i.round_id   = b.round_id
      and i.driver_id  is not distinct from b.driver_id
      and i.status <> 'in_progress'
      and i.submitted_at is not null
      and i.submitted_at between b.created_at - interval '5 seconds'
                             and b.created_at + interval '5 seconds'
    order by abs(extract(epoch from (i.submitted_at - b.created_at))) asc
    limit 1
  ) h on true
  where b.status = 'in_progress'
)
insert into app.borradores_huerfanos(id, fila, hermana_id)
select id, fila, hermana_id from huerfanos
on conflict (id) do nothing;

delete from public.inspections i
using app.borradores_huerfanos h
where i.id = h.id and i.status = 'in_progress';


-- ---------------------------------------------------------------------------
-- 3. LA GARANTÍA DURA: índices únicos parciales.
-- ---------------------------------------------------------------------------
-- Un disparador se puede desactivar y una comprobación se puede ganar por
-- carrera. Un índice único no. A partir de aquí, "dos operaciones abiertas del
-- mismo conductor" es un estado que la base de datos no sabe representar.
create unique index if not exists uq_operacion_abierta_por_conductor
  on public.inspections(driver_id)
  where operation_status = 'open' and driver_id is not null;

create unique index if not exists uq_operacion_abierta_por_vehiculo
  on public.inspections(vehicle_id)
  where operation_status = 'open';

comment on index public.uq_operacion_abierta_por_conductor is
  'Invariante: un perfil de conductor no puede figurar en dos vehículos a la '
  'vez. Sustituye a la comprobación sin cerrojo del disparador 0019, que era '
  'vulnerable a envíos simultáneos.';
comment on index public.uq_operacion_abierta_por_vehiculo is
  'Invariante: un vehículo no puede estar en dos operaciones abiertas.';


-- ---------------------------------------------------------------------------
-- 4. Reserva de perfil: deja de caducar bajo una operación abierta.
-- ---------------------------------------------------------------------------
-- La reserva es la PRUEBA de que alguien tecleó el PIN en este dispositivo.
-- Antes vivía 45 minutos y se borraba al enviar la inspección: el conductor
-- salía a ruta y su prueba de identidad desaparecía. Ahora dura un turno largo
-- y se renueva; sólo se retira cuando la operación se cierra de verdad.
create or replace function app.claim_vigente(
  p_driver_id uuid, p_device_id text, p_org uuid
) returns boolean
language sql stable security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
  select exists (
    select 1 from public.driver_claims
    where driver_id = p_driver_id
      and organization_id = p_org
      and device_id = btrim(p_device_id)
      and expires_at > now())
  and coalesce(btrim(p_device_id), '') <> '';
$$;

comment on function app.claim_vigente(uuid, text, uuid) is
  'Prueba de identidad viva: este dispositivo tecleó el PIN de este conductor '
  'y la reserva no ha caducado. Es lo que autoriza abrir y cerrar una operación.';


-- ---------------------------------------------------------------------------
-- 5. Odómetro: fuente única y monótona.
-- ---------------------------------------------------------------------------
-- Se deriva del historial en vez de guardarse en `vehicles` para que no exista
-- un segundo lugar donde la verdad pueda desincronizarse. Se usa `max` y no
-- "el último": así el resultado es monótono por construcción, aunque llegue una
-- inspección con la hora desordenada.
create or replace function app.ultimo_odometro(p_vehicle_id uuid)
returns int
language sql stable security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
  select coalesce(max(greatest(coalesce(km_final, 0), coalesce(km_inicial, 0))), 0)
  from public.inspections
  where vehicle_id = p_vehicle_id
    and status in ('authorized', 'closed');
$$;

comment on function app.ultimo_odometro(uuid) is
  'Kilometraje más alto jamás registrado para el vehículo. Impide que una '
  'inspección nueva arranque por debajo del cierre de la anterior.';


-- ---------------------------------------------------------------------------
-- 6. Disparador con cerrojo: el mensaje legible, ahora sí atómico.
-- ---------------------------------------------------------------------------
-- El índice único de arriba ya hace imposible el estado prohibido, pero su
-- error es ilegible para un conductor. Este disparador sigue existiendo para
-- explicarlo en castellano — y ahora toma un cerrojo de aviso sobre el
-- conductor ANTES de comprobar, de modo que dos envíos simultáneos del mismo
-- perfil se ponen en fila en vez de leer los dos "no hay nada abierto".
--
-- Orden de cerrojos en todo el sistema: CONDUCTOR y luego VEHÍCULO. Respetarlo
-- es lo que evita los abrazos mortales.
create or replace function app.una_operacion_por_conductor()
returns trigger
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_otra public.inspections;
begin
  -- `is distinct from` y no `<>`: con NULL, `<>` da NULL y la regla se caía
  -- silenciosamente en vez de aplicarse.
  if new.operation_status is distinct from 'open' or new.driver_id is null then
    return new;
  end if;

  -- Una operación que YA estaba abierta con el mismo conductor y el mismo
  -- vehículo no es una salida nueva. Si cambia el vehículo, sí lo es: hay que
  -- revalidar, porque si no se podría reapuntar una operación abierta a otra
  -- unidad sin pasar por ningún control.
  if tg_op = 'UPDATE'
     and old.operation_status = 'open'
     and old.driver_id  is not distinct from new.driver_id
     and old.vehicle_id is not distinct from new.vehicle_id then
    return new;
  end if;

  -- EL CERROJO. Sin esto, lo de abajo es un "comprobar y luego actuar" que dos
  -- transacciones simultáneas ganan a la vez. Es un cerrojo de transacción: se
  -- suelta solo al terminar, con COMMIT o con ROLLBACK.
  perform pg_advisory_xact_lock(hashtext('conductor:' || new.driver_id::text));

  select * into v_otra
  from public.inspections
  where driver_id = new.driver_id
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
  'Traduce a castellano el invariante que garantiza uq_operacion_abierta_por_'
  'conductor. Toma cerrojo de aviso sobre el conductor para que la comprobación '
  'sea atómica; el índice único es la red de seguridad si alguien lo desactiva.';


-- ---------------------------------------------------------------------------
-- 7. claim_driver: el PIN siempre deja constancia.
-- ---------------------------------------------------------------------------
-- CAMBIO CLAVE: antes, cuando el conductor tenía un vehículo en ruta, la
-- función devolvía "en_ruta" y salía SIN registrar la reserva. Resultado: la
-- persona demostraba su identidad y el sistema no se lo apuntaba en ningún
-- sitio, así que el regreso no tenía forma de exigir prueba de identidad.
-- Ahora la reserva se escribe siempre que el PIN sea correcto, y es esa reserva
-- la que autoriza tanto abrir como cerrar una operación.
create or replace function public.claim_driver(
  p_driver_id uuid, p_pin text, p_device_id text, p_device_label text default null)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
declare
  v_org uuid; v_hash text; v_name text; v_claim public.driver_claims;
  v_abierta public.inspections;
  -- Un turno largo. Antes eran 45 minutos y la prueba de identidad se
  -- evaporaba con el vehículo todavía en ruta.
  v_ttl interval := interval '12 hours';
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

  -- Limpieza de reservas caducadas (un turno que nunca cerró no bloquea para
  -- siempre). Nunca se retira la de un conductor con operación abierta.
  delete from public.driver_claims dc
   where dc.expires_at < now()
     and not exists (select 1 from public.inspections i
                      where i.driver_id = dc.driver_id and i.operation_status = 'open');

  select * into v_claim from public.driver_claims where driver_id = p_driver_id;
  if found and v_claim.device_id <> btrim(p_device_id) then
    return jsonb_build_object(
      'ok', false, 'motivo', 'en_uso',
      'desde', v_claim.claimed_at,
      'dispositivo', coalesce(v_claim.device_label, 'otro dispositivo'));
  end if;

  -- PIN correcto y perfil libre para este dispositivo: queda constancia.
  insert into public.driver_claims(driver_id, organization_id, device_id, device_label, claimed_at, expires_at)
    values (p_driver_id, v_org, btrim(p_device_id), p_device_label, now(), now() + v_ttl)
  on conflict (driver_id) do update
    set device_id = excluded.device_id,
        device_label = excluded.device_label,
        claimed_at = now(),
        expires_at = now() + v_ttl;

  -- Vehículo en ruta sin regreso registrado: no puede iniciar otra inspección,
  -- pero SÍ puede cerrar la que tiene abierta desde este mismo dispositivo.
  v_abierta := app.open_operation_of_driver(p_driver_id, v_org);
  if v_abierta.id is not null then
    return jsonb_build_object(
      'ok', false, 'motivo', 'en_ruta',
      'inspeccion', v_abierta.id,
      'placa', v_abierta.vehicle_plate,
      'conductor', v_name,
      'km_inicial', v_abierta.km_inicial,
      'desde', v_abierta.submitted_at);
  end if;

  return jsonb_build_object('ok', true, 'nombre', v_name);
end; $$;

revoke all on function public.claim_driver(uuid, text, text, text) from public, anon;
grant execute on function public.claim_driver(uuid, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. release_driver_claim: no se puede soltar la prueba en mitad de la ruta.
-- ---------------------------------------------------------------------------
-- El kiosco la llamaba justo después de enviar la inspección, borrando la
-- reserva del conductor que acababa de salir a ruta. Ahora el servidor se
-- niega: mientras haya operación abierta, la reserva es lo único que
-- demostrará quién puede registrar el regreso.
create or replace function public.release_driver_claim(p_driver_id uuid, p_device_id text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin')
    then raise exception 'No autorizado'; end if;

  if exists (select 1 from public.inspections
              where driver_id = p_driver_id and organization_id = v_org
                and operation_status = 'open') then
    return jsonb_build_object('ok', false, 'motivo', 'en_ruta');
  end if;

  delete from public.driver_claims
   where driver_id = p_driver_id and organization_id = v_org
     and device_id = btrim(p_device_id);
  return jsonb_build_object('ok', true);
end; $$;

revoke all on function public.release_driver_claim(uuid, text) from public, anon;
grant execute on function public.release_driver_claim(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. Las tres RPC del ciclo pasan a exigir el dispositivo.
-- ---------------------------------------------------------------------------
-- POR QUÉ. Hasta ahora `submit_inspection` recibía `p_driver_id` del cliente y
-- no comprobaba en ningún momento que ese conductor hubiera tecleado su PIN.
-- El PIN se verificaba en `claim_driver`, pero nada obligaba a pasar por allí:
-- quien tuviera la sesión del kiosco podía abrir una operación en nombre de
-- cualquier conductor de la empresa llamando la API directamente. Lo mismo con
-- `register_return`, que cerraba cualquier operación sin preguntar quién era.
--
-- Se retiran las versiones antiguas: dejarlas vivas sería dejar la puerta
-- abierta al lado de la puerta nueva.
drop function if exists public.save_inspection_draft(uuid, uuid, jsonb, integer, text, text);
drop function if exists public.submit_inspection(uuid, uuid, jsonb, integer, text, text, text);
drop function if exists public.register_return(uuid, integer, text);


-- ---------------------------------------------------------------------------
-- 9.1 save_inspection_draft — y el fin de los borradores huérfanos.
-- ---------------------------------------------------------------------------
create or replace function public.save_inspection_draft(
  p_vehicle_id uuid, p_driver_id uuid, p_answers jsonb,
  p_km_inicial int, p_fuel_in text, p_obs text, p_device_id text)
returns uuid
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_org uuid; v_round public.rounds; v_id uuid; v_plate text; v_drv text;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin')
    then raise exception 'No autorizado'; end if;

  -- Prueba de identidad: el borrador ya lleva el nombre del conductor y su
  -- kilometraje, así que tampoco se escribe sin PIN.
  if not app.claim_vigente(p_driver_id, p_device_id, v_org) then
    raise exception 'Identidad no verificada. Vuelve a introducir el PIN del conductor.';
  end if;

  select * into v_round from public.rounds
    where organization_id = v_org and status='open' order by round_number desc limit 1;
  if not found then raise exception 'No hay una ronda abierta'; end if;

  -- EL ARREGLO DEL HUÉRFANO. El autoguardado del kiosco viaja con 1,5 s de
  -- retardo; si llega después de que la inspección se enviara, antes insertaba
  -- una fila nueva porque ya no había ningún borrador que actualizar. Ahora
  -- comprueba primero si el vehículo ya tiene inspección viva en esta ronda y,
  -- si la tiene, no escribe nada: el autoguardado llegó tarde y no hay nada
  -- que guardar.
  if exists (select 1 from public.inspections
              where vehicle_id = p_vehicle_id and round_id = v_round.id
                and status <> 'in_progress' and released = false) then
    return null;
  end if;

  select plate into v_plate from public.vehicles where id=p_vehicle_id and organization_id=v_org;
  select full_name into v_drv from public.drivers where id=p_driver_id and organization_id=v_org;

  insert into public.inspections(
    organization_id, round_id, vehicle_id, driver_id, vehicle_plate, driver_name,
    answers, km_inicial, fuel_in, obs_general, status, device_id, created_by, submitted_at)
  values (v_org, v_round.id, p_vehicle_id, p_driver_id, v_plate, v_drv,
    coalesce(p_answers,'[]'::jsonb), p_km_inicial, p_fuel_in, coalesce(p_obs,''),
    'in_progress', nullif(btrim(p_device_id),''), auth.uid(), null)
  on conflict (vehicle_id, round_id) where (status='in_progress')
  do update set answers = excluded.answers, km_inicial = excluded.km_inicial,
     fuel_in = excluded.fuel_in, obs_general = excluded.obs_general,
     driver_id = excluded.driver_id, driver_name = excluded.driver_name,
     device_id = excluded.device_id, updated_at = now()
  returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.save_inspection_draft(uuid, uuid, jsonb, integer, text, text, text) from public, anon;
grant execute on function public.save_inspection_draft(uuid, uuid, jsonb, integer, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 9.2 submit_inspection — abre la operación, con identidad y odómetro.
-- ---------------------------------------------------------------------------
create or replace function public.submit_inspection(
  p_vehicle_id uuid, p_driver_id uuid, p_answers jsonb,
  p_km_inicial int, p_fuel_in text, p_obs text, p_idempotency_key text,
  p_device_id text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare
  v_org uuid; v_uid uuid := auth.uid();
  v_round public.rounds; v_veh public.vehicles; v_ver public.checklist_versions;
  v_maxbad int; v_elem jsonb;
  v_type app.item_type; v_sev app.answer_severity; v_crit boolean;
  v_ok int:=0; v_warn int:=0; v_bad int:=0; v_total int:=0; v_noncrit_bad int:=0;
  v_reasons text[] := '{}'; v_authorized boolean; v_result app.inspection_result;
  v_insp_id uuid; v_existing public.inspections; v_issue_id uuid; v_ev text;
  v_name text; v_item_id uuid; v_odo int; v_dev text := nullif(btrim(p_device_id),'');
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin')
    then raise exception 'No autorizado'; end if;

  -- Reenvío de la cola sin señal: se resuelve ANTES de cualquier otra
  -- comprobación, para que un reintento nunca cambie el resultado.
  if p_idempotency_key is not null then
    select * into v_existing from public.inspections
      where organization_id=v_org and idempotency_key=p_idempotency_key;
    if found then
      return jsonb_build_object('id', v_existing.id, 'authorized', v_existing.authorized,
        'result', v_existing.result, 'status', v_existing.status,
        'reasons', v_existing.auth_reasons, 'idempotent', true);
    end if;
  end if;

  -- PRUEBA DE IDENTIDAD. Sin reserva viva de este conductor en este
  -- dispositivo no se abre ninguna operación: el PIN deja de ser un paso de la
  -- interfaz y pasa a ser un requisito del servidor.
  if not app.claim_vigente(p_driver_id, p_device_id, v_org) then
    raise exception 'Identidad no verificada. Vuelve a introducir el PIN del conductor.';
  end if;

  -- ORDEN DE CERROJOS: conductor y luego vehículo, siempre. El disparador
  -- volverá a pedir el del conductor y lo encontrará ya en la mano.
  if p_driver_id is not null then
    perform pg_advisory_xact_lock(hashtext('conductor:' || p_driver_id::text));
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

  -- CONTINUIDAD DEL ODÓMETRO. Un cuentakilómetros no retrocede. En los datos
  -- auditados ZZZ-001 pasó de 10.000 a 1.000 km y de 11.233 a 10.000 sin que
  -- nada protestara, dejando el histórico de recorrido inservible.
  v_odo := app.ultimo_odometro(p_vehicle_id);
  if p_km_inicial is not null and p_km_inicial < v_odo then
    raise exception
      'El odómetro de % marcaba % km al cierre de la operación anterior. El kilometraje inicial no puede ser menor.',
      v_veh.plate, to_char(v_odo, 'FM999G999G999');
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
    else v_bad := v_bad+1;
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
      device_id=coalesce(v_dev, device_id),
      submitted_at=now(), authorized_at=(case when v_authorized then now() else null end)
    where id=v_existing.id returning id into v_insp_id;
  else
    insert into public.inspections(
      organization_id, round_id, vehicle_id, driver_id, vehicle_plate, driver_name,
      checklist_version_id, checklist_version_number, checklist_snapshot, answers,
      status, result, authorized, auth_reasons, km_inicial, fuel_in, obs_general,
      ok_count, warn_count, bad_count, total_items, operation_status,
      idempotency_key, device_id, created_by, submitted_at, authorized_at)
    values (
      v_org, v_round.id, p_vehicle_id, p_driver_id, v_veh.plate,
      (select full_name from public.drivers where id=p_driver_id),
      v_ver.id, v_ver.version_number, v_ver.structure, coalesce(p_answers,'[]'::jsonb),
      (case when v_authorized then 'authorized' else 'rejected' end)::app.inspection_status,
      v_result, v_authorized, to_jsonb(v_reasons), p_km_inicial, p_fuel_in, coalesce(p_obs,''),
      v_ok, v_warn, v_bad, v_total,
      (case when v_authorized then 'open' else 'none' end)::app.operation_status,
      p_idempotency_key, v_dev, v_uid, now(), (case when v_authorized then now() else null end))
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

  -- Una inspección RECHAZADA no abre operación, así que el perfil queda libre
  -- de inmediato. Una AUTORIZADA sí: la reserva se conserva porque es la
  -- prueba de identidad que autorizará el regreso.
  if not v_authorized then
    delete from public.driver_claims where driver_id = p_driver_id and organization_id = v_org;
  end if;

  perform app.write_audit('inspection_submitted','inspection', v_insp_id::text, null,
    jsonb_build_object('authorized',v_authorized,'result',v_result,'reasons',to_jsonb(v_reasons)),
    jsonb_build_object('vehicle',v_veh.plate,'round',v_round.round_number,'odometro_previo',v_odo));
  return jsonb_build_object('id',v_insp_id,'authorized',v_authorized,'result',v_result,
    'status',(case when v_authorized then 'authorized' else 'rejected' end),
    'reasons',to_jsonb(v_reasons),'ok',v_ok,'warn',v_warn,'bad',v_bad,'idempotent',false);

exception
  when unique_violation then
    -- ANTES: este bloque capturaba CUALQUIER violación de unicidad y devolvía
    -- la inspección del vehículo como si el envío hubiera sido un reintento
    -- idempotente. Si no encontraba ninguna, devolvía un objeto con id nulo:
    -- un fallo disfrazado de éxito. Y habría tragado precisamente los índices
    -- que esta migración añade. Ahora sólo se reconoce el caso para el que se
    -- escribió, y cualquier otro sube tal cual.
    declare v_restriccion text;
    begin
      get stacked diagnostics v_restriccion = constraint_name;
      if v_restriccion = 'uq_operacion_abierta_por_conductor' then
        raise exception 'Este conductor ya tiene un vehículo en ruta. Debe registrar el regreso antes de iniciar otra inspección.';
      elsif v_restriccion = 'uq_operacion_abierta_por_vehiculo' then
        raise exception 'Este vehículo ya está en ruta con una operación abierta.';
      elsif v_restriccion in ('uq_insp_vehicle_round_active','uq_insp_vehicle_round_draft','uq_insp_idempotency') then
        select * into v_existing from public.inspections
          where vehicle_id=p_vehicle_id and round_id=v_round.id
            and status in ('submitted','authorized','rejected','closed') and released=false limit 1;
        if v_existing.id is null then raise; end if;
        return jsonb_build_object('id', v_existing.id, 'authorized', v_existing.authorized,
          'result', v_existing.result, 'status', v_existing.status,
          'reasons', v_existing.auth_reasons, 'idempotent', true);
      else
        raise;
      end if;
    end;
end; $$;

revoke all on function public.submit_inspection(uuid, uuid, jsonb, integer, text, text, text, text) from public, anon;
grant execute on function public.submit_inspection(uuid, uuid, jsonb, integer, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 9.2b Duración en palabras, para que los mensajes se entiendan.
-- ---------------------------------------------------------------------------
create or replace function app.en_palabras(p_segundos int)
returns text
language sql immutable
as $$
  select case
    when p_segundos < 60  then p_segundos || ' segundos'
    when p_segundos < 120 then '1 minuto'
    when p_segundos < 3600 then (p_segundos / 60) || ' minutos'
    when p_segundos < 7200 then '1 hora'
    else (p_segundos / 3600) || ' horas'
  end;
$$;


-- ---------------------------------------------------------------------------
-- 9.3 register_return — el cierre deja de ser un botón y pasa a ser un cierre.
-- ---------------------------------------------------------------------------
-- Tres invariantes, en este orden:
--   1. IDENTIDAD  — quien cierra tecleó el PIN de ese conductor en este equipo.
--   2. FÍSICA     — el odómetro no retrocede, la distancia y la velocidad media
--                   implícita son posibles. No se negocia.
--   3. POLÍTICA   — permanencia mínima entre salida y regreso, ajustable por
--                   empresa. Un administrador puede saltársela dejando motivo.
create or replace function public.register_return(
  p_inspection_id uuid, p_km_final int, p_fuel_out text, p_device_id text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare
  v_org uuid; v_insp public.inspections; v_abiertas int; v_liberado boolean := false;
  v_min int; v_max_km int; v_max_kmh int;
  v_segundos int; v_recorrido int; v_kmh numeric;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin')
    then raise exception 'No autorizado'; end if;

  select * into v_insp from public.inspections
    where id=p_inspection_id and organization_id=v_org for update;
  if not found then raise exception 'Inspección no encontrada'; end if;
  if v_insp.operation_status <> 'open' then raise exception 'La operación no está abierta'; end if;

  -- 1. IDENTIDAD. Antes bastaba con tener abierta la sesión del kiosco para
  -- cerrar la operación de cualquier conductor. El regreso puede registrarse
  -- desde cualquier equipo —esa capacidad se conserva a propósito, para quien
  -- se queda sin teléfono— pero siempre después de teclear el PIN.
  if not app.claim_vigente(v_insp.driver_id, p_device_id, v_org) then
    raise exception 'Identidad no verificada. Introduce el PIN del conductor para registrar el regreso.';
  end if;

  select coalesce(min_operacion_segundos,300), coalesce(max_km_operacion,2000),
         coalesce(max_kmh_operacion,120)
    into v_min, v_max_km, v_max_kmh
    from public.organizations where id = v_org;

  v_segundos  := greatest(extract(epoch from (now() - coalesce(v_insp.submitted_at, v_insp.created_at)))::int, 0);
  v_recorrido := coalesce(p_km_final, 0) - coalesce(v_insp.km_inicial, coalesce(p_km_final, 0));

  -- 2. FÍSICA.
  if v_insp.km_inicial is not null and p_km_final is not null and p_km_final < v_insp.km_inicial then
    raise exception 'El kilometraje final no puede ser menor al inicial';
  end if;
  if v_recorrido > v_max_km then
    raise exception
      'El recorrido registrado (% km) supera el máximo admitido para una operación (% km). Revisa el kilometraje final.',
      to_char(v_recorrido,'FM999G999G999'), to_char(v_max_km,'FM999G999G999');
  end if;
  if v_segundos > 0 and v_recorrido > 0 then
    v_kmh := (v_recorrido::numeric * 3600) / v_segundos;
    if v_kmh > v_max_kmh then
      raise exception
        'El kilometraje no es posible: % km en % minutos equivalen a % km/h de media. Revisa el dato.',
        to_char(v_recorrido,'FM999G999G999'),
        to_char(round(v_segundos/60.0, 1),'FM999G999D9'),
        to_char(round(v_kmh), 'FM999G999G999');
    end if;
  end if;

  -- 3. POLÍTICA. Aquí es donde muere la "reutilización inmediata": un vehículo
  -- que salió hace veintiún segundos no puede haber vuelto.
  if v_min > 0 and v_segundos < v_min then
    raise exception
      'La salida se registró hace % y la permanencia mínima configurada es de %. Si el regreso es real, un administrador puede cerrarla desde el panel dejando constancia del motivo.',
      app.en_palabras(v_segundos), app.en_palabras(v_min);
  end if;

  update public.inspections set km_final=p_km_final, fuel_out=p_fuel_out,
    operation_status='closed', status='closed', closed_at=now()
  where id=p_inspection_id;

  -- ¿Volvió limpio? Si no dejó novedades sin resolver, el vehículo se libera y
  -- vuelve a estar disponible en la misma ronda: cumplió su ciclo completo.
  select count(*) into v_abiertas from public.issues
    where vehicle_id = v_insp.vehicle_id and status <> 'resolved';

  if v_abiertas = 0 then
    update public.inspections set released = true where id = p_inspection_id;
    v_liberado := true;
  end if;

  -- Cerrada la operación, la prueba de identidad ya cumplió su función.
  delete from public.driver_claims where driver_id = v_insp.driver_id and organization_id = v_org;

  perform app.write_audit('operation_closed','inspection',p_inspection_id::text,
    jsonb_build_object('km_inicial',v_insp.km_inicial),
    jsonb_build_object('km_final',p_km_final,'fuel_out',p_fuel_out,'liberado',v_liberado,
                       'duracion_segundos',v_segundos,'recorrido_km',v_recorrido), null);

  return jsonb_build_object('id',p_inspection_id,'status','closed',
    'recorrido', v_recorrido,
    'duracion_segundos', v_segundos,
    'vehiculo_liberado', v_liberado,
    'novedades_pendientes', v_abiertas);
end; $$;

revoke all on function public.register_return(uuid, integer, text, text) from public, anon;
grant execute on function public.register_return(uuid, integer, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 10. La salida supervisada: cerrar una operación que incumple la política.
-- ---------------------------------------------------------------------------
-- Un control que no deja salida legítima acaba desactivado. Casos reales: un
-- movimiento de patio de dos minutos, o un conductor que se marchó sin
-- registrar el regreso. Esto lo resuelve un administrador, con motivo
-- obligatorio y rastro en la auditoría — nunca el kiosco.
--
-- Se salta la POLÍTICA (permanencia mínima y topes de plausibilidad) porque
-- para eso existe. NO se salta la física elemental: el odómetro sigue sin poder
-- retroceder, porque eso no es una excepción operativa sino un dato erróneo.
create or replace function public.force_close_operation(
  p_inspection_id uuid, p_km_final int, p_fuel_out text, p_reason text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare v_org uuid; v_insp public.inspections; v_abiertas int; v_liberado boolean := false;
        v_segundos int; v_recorrido int;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then raise exception 'No autorizado'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'Indica el motivo del cierre manual (mínimo 5 caracteres)';
  end if;

  select * into v_insp from public.inspections
    where id=p_inspection_id and organization_id=v_org for update;
  if not found then raise exception 'Inspección no encontrada'; end if;
  if v_insp.operation_status <> 'open' then raise exception 'La operación no está abierta'; end if;

  if v_insp.km_inicial is not null and p_km_final is not null and p_km_final < v_insp.km_inicial then
    raise exception 'El kilometraje final no puede ser menor al inicial';
  end if;

  v_segundos  := greatest(extract(epoch from (now() - coalesce(v_insp.submitted_at, v_insp.created_at)))::int, 0);
  v_recorrido := coalesce(p_km_final, 0) - coalesce(v_insp.km_inicial, coalesce(p_km_final, 0));

  update public.inspections set km_final=p_km_final, fuel_out=p_fuel_out,
    operation_status='closed', status='closed', closed_at=now()
  where id=p_inspection_id;

  select count(*) into v_abiertas from public.issues
    where vehicle_id = v_insp.vehicle_id and status <> 'resolved';
  if v_abiertas = 0 then
    update public.inspections set released = true where id = p_inspection_id;
    v_liberado := true;
  end if;

  delete from public.driver_claims where driver_id = v_insp.driver_id and organization_id = v_org;

  perform app.write_audit('operation_force_closed','inspection',p_inspection_id::text,
    jsonb_build_object('km_inicial',v_insp.km_inicial,'submitted_at',v_insp.submitted_at),
    jsonb_build_object('km_final',p_km_final,'fuel_out',p_fuel_out,'liberado',v_liberado,
                       'duracion_segundos',v_segundos,'recorrido_km',v_recorrido,
                       'motivo',btrim(p_reason)), null);

  return jsonb_build_object('id',p_inspection_id,'status','closed',
    'recorrido', v_recorrido, 'duracion_segundos', v_segundos,
    'vehiculo_liberado', v_liberado, 'novedades_pendientes', v_abiertas, 'forzado', true);
end; $$;

revoke all on function public.force_close_operation(uuid, integer, text, text) from public, anon;
grant execute on function public.force_close_operation(uuid, integer, text, text) to authenticated;

comment on function public.force_close_operation(uuid, integer, text, text) is
  'Cierre supervisado de una operación que no cumple la permanencia mínima o '
  'los topes de plausibilidad. Sólo administración, con motivo obligatorio y '
  'rastro en auditoría. El odómetro sigue sin poder retroceder.';
