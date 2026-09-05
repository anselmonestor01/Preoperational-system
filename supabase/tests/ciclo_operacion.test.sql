-- =============================================================================
-- PREOPERATIONAL SYSTEM — El ciclo salida → operación → regreso
-- =============================================================================
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- Una auditoría sobre datos reales encontró que un mismo perfil de conductor
-- había ejecutado cinco inspecciones en una sola ronda, que había operaciones
-- de 10 segundos con 101.111 km recorridos, y que el odómetro de un vehículo
-- había retrocedido dos veces sin que nada protestara. La causa no era un
-- despiste puntual: la regla "un conductor, una operación" existía sólo como
-- una comprobación dentro de un disparador, y una comprobación sin cerrojo la
-- ganan dos transacciones simultáneas a la vez.
--
-- Cada prueba de aquí abajo comprueba UNA de las garantías que introdujeron las
-- migraciones 0027 y 0028. Las marcadas [ANTES] reconstruyen el sistema como
-- estaba y demuestran que fallaba: sin eso, una prueba en verde no significa
-- nada, porque no se sabe si estaba probando algo.
--
--   psql "$DATABASE_URL" -f supabase/tests/ciclo_operacion.test.sql
--
-- Todo ocurre dentro de una transacción que se REVIERTE: no deja ni un registro.
-- =============================================================================

begin;

create temp table qa(orden int, paso text, obtenido text, esperado text);
create temp table ids(
  org uuid, ronda uuid, conductor uuid, conductor2 uuid,
  veh1 uuid, veh2 uuid, insp uuid, disp text default 'equipo-de-pruebas');

insert into ids(org, conductor, conductor2, veh1, veh2)
select v.organization_id,
       (select id from public.drivers where organization_id=v.organization_id and active order by full_name limit 1),
       (select id from public.drivers where organization_id=v.organization_id and active order by full_name offset 1 limit 1),
       v.id,
       (select id from public.vehicles where organization_id=v.organization_id and status='active' and id<>v.id order by plate limit 1)
from public.vehicles v where v.status='active' order by v.plate limit 1;

-- Contexto de sesión: se actúa como el usuario del kiosco.
select set_config('request.jwt.claims',
  json_build_object('sub', (select id::text from public.profiles
                             where organization_id=(select org from ids)
                               and role in ('operator','admin','superadmin') and active limit 1),
                    'role','authenticated')::text, true);

-- ESCENARIO LIMPIO. Todo lo de aquí abajo se revierte al terminar; se hace
-- para que las pruebas no dependan del estado con el que esté la base ese día.
-- Las placas se renombran para que los mensajes de error sean predecibles.
update public.vehicles set plate='QA-001', status='active', admin_blocked=false,
       admin_block_reason='', blocked_at=null, blocked_by=null
 where id=(select veh1 from ids);
update public.vehicles set plate='QA-002', status='active', admin_blocked=false,
       admin_block_reason='', blocked_at=null, blocked_by=null
 where id=(select veh2 from ids);
update public.issues set status='resolved'
 where vehicle_id in (select veh1 from ids union select veh2 from ids) and status<>'resolved';
update public.inspections set operation_status='closed'
 where organization_id=(select org from ids) and operation_status='open';
delete from public.driver_claims where organization_id=(select org from ids);

-- Escenario limpio: una ronda abierta y dos vehículos sin novedades.
update public.rounds set status='closed' where organization_id=(select org from ids) and status='open';
with nueva as (
  insert into public.rounds(organization_id, round_number, label, status)
  select org, 9001, 'Ronda de pruebas 0027', 'open' from ids
  returning id
)
update ids set ronda = (select id from nueva);


-- ============================================================ 1. LA GARANTÍA
-- El invariante lo garantiza el MOTOR, no la comprobación.
-- ---------------------------------------------------------------------------
-- Se desactiva el disparador a propósito: simula exactamente lo que ocurre en
-- una carrera, donde la comprobación se ejecuta y no ve a la otra transacción.
-- Si el sistema sólo dependiera de ella, el estado prohibido se escribiría.
alter table public.inspections disable trigger trg_una_operacion_por_conductor;

do $blk$
declare v_org uuid; v_ronda uuid; v_c uuid; v1 uuid; v2 uuid; v_falla text;
begin
  select org, ronda, conductor, veh1, veh2 into v_org, v_ronda, v_c, v1, v2 from ids;

  insert into public.inspections(organization_id, round_id, vehicle_id, driver_id,
    vehicle_plate, status, operation_status, km_inicial, submitted_at)
  values (v_org, v_ronda, v1, v_c, 'QA-001', 'authorized', 'open', 50000, now());

  begin
    insert into public.inspections(organization_id, round_id, vehicle_id, driver_id,
      vehicle_plate, status, operation_status, km_inicial, submitted_at)
    values (v_org, v_ronda, v2, v_c, 'QA-002', 'authorized', 'open', 50000, now());
    v_falla := 'ACEPTADA (el motor no lo impidió)';
  exception when unique_violation then
    get stacked diagnostics v_falla = constraint_name;
  end;

  insert into qa values (1,
    'Segunda operación abierta del mismo conductor, con el disparador DESACTIVADO',
    v_falla, 'uq_operacion_abierta_por_conductor');
end $blk$;

-- [ANTES] Sin el índice —el sistema tal como estaba— el mismo estado se
-- escribía sin protestar. Se demuestra y se deshace a mano, sin `savepoint`:
-- un `rollback to savepoint` desharía también el apunte en la tabla de
-- resultados, y la prueba desaparecería del informe sin decir nada.
alter table public.inspections disable trigger trg_una_operacion_por_conductor;
drop index public.uq_operacion_abierta_por_conductor;

do $blk$
declare v_org uuid; v_ronda uuid; v_c uuid; v2 uuid; v_n int; v_id uuid;
begin
  select org, ronda, conductor, veh2 into v_org, v_ronda, v_c, v2 from ids;
  insert into public.inspections(organization_id, round_id, vehicle_id, driver_id,
    vehicle_plate, status, operation_status, km_inicial, submitted_at)
  values (v_org, v_ronda, v2, v_c, 'QA-002', 'authorized', 'open', 50000, now())
  returning id into v_id;

  select count(*) into v_n from public.inspections
   where driver_id = v_c and operation_status = 'open';

  -- Que aquí se espere 2 es lo que da valor a la prueba nº 1: demuestra que
  -- sin el índice el estado prohibido SÍ se escribía, y por tanto que la
  -- prueba nº 1 está comprobando algo real y no una imposibilidad de partida.
  insert into qa values (2,
    '[ANTES] Sin el índice, el mismo conductor acababa con dos vehículos en ruta',
    v_n::text, '2');

  delete from public.inspections where id = v_id;
end $blk$;

create unique index uq_operacion_abierta_por_conductor
  on public.inspections(driver_id)
  where operation_status = 'open' and driver_id is not null;
alter table public.inspections enable trigger trg_una_operacion_por_conductor;

-- El mensaje que ve el conductor, con el disparador activo.
do $blk$
declare v_org uuid; v_ronda uuid; v_c uuid; v2 uuid; v_msg text;
begin
  select org, ronda, conductor, veh2 into v_org, v_ronda, v_c, v2 from ids;
  begin
    insert into public.inspections(organization_id, round_id, vehicle_id, driver_id,
      vehicle_plate, status, operation_status, km_inicial, submitted_at)
    values (v_org, v_ronda, v2, v_c, 'QA-002', 'authorized', 'open', 50000, now());
    v_msg := 'no falló: se aceptó la segunda salida';
  exception when others then
    v_msg := case when sqlerrm like 'Este conductor tiene el vehículo QA-001 en ruta desde las %'
                  then 'bloqueado, nombrando el vehículo y la hora' else sqlerrm end;
  end;
  insert into qa values (3, 'El disparador traduce el invariante a castellano',
    v_msg, 'bloqueado, nombrando el vehículo y la hora');
end $blk$;


-- ================================================ 2. PERMANENCIA Y PLAUSIBILIDAD
update ids set insp = (select id from public.inspections
  where driver_id=(select conductor from ids) and operation_status='open' limit 1);

-- Sin reserva de perfil no se cierra nada, aunque el identificador sea correcto.
do $blk$
declare v_msg text;
begin
  delete from public.driver_claims where driver_id = (select conductor from ids);
  begin
    perform public.register_return((select insp from ids), 50010, 'lleno', (select disp from ids));
    v_msg := 'cerró sin PIN';
  exception when others then
    v_msg := case when sqlerrm like 'Identidad no verificada%' then 'rechazado' else sqlerrm end;
  end;
  insert into qa values (4, 'Registrar el regreso sin haber tecleado el PIN',
    v_msg, 'rechazado');
end $blk$;

-- Con la reserva de OTRO dispositivo, tampoco.
insert into public.driver_claims(driver_id, organization_id, device_id, claimed_at, expires_at)
select conductor, org, 'otro-equipo', now(), now() + interval '1 hour' from ids;

do $blk$
declare v_msg text;
begin
  begin
    perform public.register_return((select insp from ids), 50010, 'lleno', (select disp from ids));
    v_msg := 'cerró desde otro equipo';
  exception when others then
    v_msg := case when sqlerrm like 'Identidad no verificada%' then 'rechazado' else sqlerrm end;
  end;
  insert into qa values (5, 'Registrar el regreso con la reserva de otro dispositivo',
    v_msg, 'rechazado');
end $blk$;

update public.driver_claims set device_id = (select disp from ids)
 where driver_id = (select conductor from ids);

-- La permanencia mínima: la salida se acaba de registrar.
update public.organizations set min_operacion_segundos = 300, max_kmh_operacion = 120
 where id = (select org from ids);

do $blk$
declare v_msg text;
begin
  begin
    perform public.register_return((select insp from ids), 50010, 'lleno', (select disp from ids));
    v_msg := 'cerró en el mismo segundo';
  exception when others then
    v_msg := case when sqlerrm like 'La salida se registró hace % y la permanencia mínima%'
                  then 'rechazado, diciendo cuánto falta' else sqlerrm end;
  end;
  insert into qa values (6, 'Regreso registrado en el mismo minuto que la salida',
    v_msg, 'rechazado, diciendo cuánto falta');
end $blk$;

-- La física: 101.111 km en unos segundos, el caso real que apareció en los datos.
update public.organizations set min_operacion_segundos = 0 where id = (select org from ids);
do $blk$
declare v_msg text;
begin
  begin
    perform public.register_return((select insp from ids), 151111, 'lleno', (select disp from ids));
    v_msg := 'aceptó 101.111 km';
  exception when others then
    v_msg := case when sqlerrm like 'El recorrido registrado (%km) supera el máximo admitido%'
                  then 'rechazado por implausible' else sqlerrm end;
  end;
  insert into qa values (7, 'Recorrido imposible para el tiempo transcurrido',
    v_msg, 'rechazado por implausible');
end $blk$;

-- Un regreso plausible sí se acepta.
do $blk$
declare v_res jsonb;
begin
  v_res := public.register_return((select insp from ids), 50120, 'medio', (select disp from ids));
  insert into qa values (8, 'Regreso plausible: se cierra la operación',
    (v_res->>'status') || ', ' || (v_res->>'recorrido') || ' km', 'closed, 120 km');
end $blk$;

-- Y al cerrarse, la reserva del perfil se retira.
insert into qa
select 9, 'Cerrada la operación, la reserva del perfil se retira',
       count(*)::text, '0'
from public.driver_claims where driver_id = (select conductor from ids);


-- ====================================================== 3. ODÓMETRO MONÓTONO
-- El vehículo cerró en 50.120 km. Una inspección nueva no puede arrancar antes.
insert into public.driver_claims(driver_id, organization_id, device_id, claimed_at, expires_at)
select conductor2, org, disp, now(), now() + interval '1 hour' from ids;

do $blk$
declare v_msg text;
begin
  begin
    perform public.submit_inspection((select veh1 from ids), (select conductor2 from ids),
      '[]'::jsonb, 40000, 'lleno', '', null, (select disp from ids));
    v_msg := 'aceptó el retroceso';
  exception when others then
    v_msg := case when sqlerrm like 'El odómetro de QA-001 marcaba % km al cierre de la operación anterior.%'
                  then 'rechazado, citando el cierre anterior' else sqlerrm end;
  end;
  insert into qa values (10, 'Inspección que arranca por debajo del odómetro anterior',
    v_msg, 'rechazado, citando el cierre anterior');
end $blk$;


-- =========================================== 4. EL BORRADOR QUE LLEGA TARDE
-- El vehículo veh2 recibe una inspección; el autoguardado retrasado del kiosco
-- ya no debe crear una fila nueva.
do $blk$
declare v_id uuid; v_antes int; v_despues int;
begin
  perform public.submit_inspection((select veh2 from ids), (select conductor2 from ids),
    '[]'::jsonb, 60000, 'lleno', '', null, (select disp from ids));
  select count(*) into v_antes from public.inspections where vehicle_id=(select veh2 from ids);
  v_id := public.save_inspection_draft((select veh2 from ids), (select conductor2 from ids),
    '[]'::jsonb, 60000, 'lleno', '', (select disp from ids));
  select count(*) into v_despues from public.inspections where vehicle_id=(select veh2 from ids);
  insert into qa values (11, 'Autoguardado que llega después del envío',
    coalesce(v_id::text,'sin fila') || ', filas ' || v_antes || '→' || v_despues,
    'sin fila, filas ' || v_antes || '→' || v_antes);
end $blk$;


-- ================================================ 5. BARRIDO DEL MISMO PATRÓN
-- La operación de veh2 quedó abierta. Un administrador no puede declarar
-- disponible un vehículo que sigue en ruta.
select set_config('request.jwt.claims',
  json_build_object('sub', (select id::text from public.profiles
                             where organization_id=(select org from ids)
                               and role in ('admin','superadmin') and active limit 1),
                    'role','authenticated')::text, true);

do $blk$
declare v_msg text; v_insp uuid;
begin
  select id into v_insp from public.inspections
   where vehicle_id=(select veh2 from ids) and operation_status='open' limit 1;
  begin
    perform public.release_inspection(v_insp);
    v_msg := 'liberó un vehículo en ruta';
  exception when others then
    v_msg := case when sqlerrm like 'El vehículo QA-002 sigue en ruta con %'
                  then 'rechazado, nombrando al conductor' else sqlerrm end;
  end;
  insert into qa values (12, 'Liberar un vehículo cuya operación sigue abierta',
    v_msg, 'rechazado, nombrando al conductor');
end $blk$;

-- Y no puede soltar la reserva de un conductor en ruta: es su prueba de identidad.
do $blk$
declare v_res jsonb; v_quedan int;
begin
  v_res := public.release_driver_claim((select conductor2 from ids), (select disp from ids));
  select count(*) into v_quedan from public.driver_claims where driver_id=(select conductor2 from ids);
  insert into qa values (13, 'Soltar la reserva del perfil con el vehículo en ruta',
    (v_res->>'motivo') || ', quedan ' || v_quedan, 'en_ruta, quedan 1');
end $blk$;

-- El cierre supervisado sí puede, y deja constancia.
do $blk$
declare v_res jsonb; v_insp uuid; v_motivo text;
begin
  select id into v_insp from public.inspections
   where vehicle_id=(select veh2 from ids) and operation_status='open' limit 1;
  v_res := public.force_close_operation(v_insp, 60005, 'medio', 'Movimiento de patio, prueba de auditoría');
  select new_value->>'motivo' into v_motivo from public.audit_logs
   where action='operation_force_closed' and entity_id=v_insp::text
   order by created_at desc limit 1;
  insert into qa values (14, 'Cierre supervisado por administración, con motivo auditado',
    (v_res->>'status') || ', motivo ' || (case when v_motivo is null then 'NO registrado' else 'registrado' end),
    'closed, motivo registrado');
end $blk$;

-- Una operación ya cerrada no se puede reabrir con un override.
do $blk$
declare v_msg text; v_insp uuid;
begin
  select id into v_insp from public.inspections
   where vehicle_id=(select veh2 from ids) order by created_at desc limit 1;
  begin
    perform public.override_authorization(v_insp, true, 'Intento de reabrir una operación terminada');
    v_msg := 'reabrió una operación cerrada';
  exception when others then
    v_msg := case when sqlerrm like 'La operación ya se cerró con su regreso registrado%'
                  then 'rechazado' else sqlerrm end;
  end;
  insert into qa values (15, 'Override que reabriría una operación ya cerrada',
    v_msg, 'rechazado');
end $blk$;


-- ===================================================================== SALIDA
select orden, paso,
       case when obtenido = esperado then '✅' else '❌' end as ok,
       obtenido, esperado
from qa order by orden;

select count(*) filter (where obtenido = esperado) || ' de ' || count(*) || ' comprobaciones en verde' as resumen
from qa;

rollback;
