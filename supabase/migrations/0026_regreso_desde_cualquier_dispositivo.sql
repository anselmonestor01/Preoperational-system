-- =============================================================================
-- 0026 — Salir del callejón sin salida del "vehículo en ruta"
-- =============================================================================
-- EL PROBLEMA, VISTO EN OPERACIÓN REAL
-- Un conductor registró la salida de un vehículo y su teléfono se apagó. Al
-- volver, el sistema le impedía iniciar otra inspección —correctamente, porque
-- no había registrado el regreso— pero NO le ofrecía ninguna forma de
-- registrarlo: el kiosco sólo muestra el formulario de regreso de las salidas
-- abiertas desde ESE MISMO dispositivo, identificado por un valor guardado en
-- el navegador. Borrado ese valor, cambiado de teléfono o abierto el kiosco en
-- otra pestaña, el conductor quedaba bloqueado indefinidamente.
--
-- La restricción por dispositivo tenía sentido —el regreso lo cierra quien
-- registró la salida— pero convertía un percance de dos minutos en un bloqueo
-- que sólo un administrador podía deshacer.
--
-- LA SALIDA
-- `claim_driver` ya verifica el PIN antes de responder "en_ruta". Ese PIN es
-- una prueba de identidad MÁS fuerte que un identificador de navegador, que
-- cualquiera puede copiar o borrar. Así que cuando la respuesta es "en_ruta"
-- ahora se devuelve también CUÁL es la operación abierta, para que el kiosco
-- ofrezca cerrarla allí mismo, a quien acaba de demostrar que es el conductor.
--
-- `register_return` no cambia: nunca tuvo restricción de dispositivo, la
-- limitación era sólo de interfaz.
-- =============================================================================

begin;

create or replace function public.claim_driver(
  p_driver_id uuid, p_pin text, p_device_id text, p_device_label text default null)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $fn$
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

  if v_hash is null or v_hash <> extensions.crypt(p_pin, v_hash) then
    return jsonb_build_object('ok', false, 'motivo', 'pin');
  end if;

  -- Vehículo en ruta sin regreso registrado. Se devuelve la operación completa
  -- para que el kiosco pueda ofrecer el cierre en el acto: el PIN que se acaba
  -- de verificar es la prueba de identidad, no el navegador desde el que entra.
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
end;
$fn$;

revoke all on function public.claim_driver(uuid, text, text, text) from public, anon;
grant execute on function public.claim_driver(uuid, text, text, text) to authenticated;

commit;
