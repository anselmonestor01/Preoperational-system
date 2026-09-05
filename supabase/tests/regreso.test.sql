-- =============================================================================
-- PREOPERATIONAL SYSTEM — El conductor con un vehículo en ruta puede desatascarse
-- =============================================================================
-- POR QUÉ EXISTE ESTE ARCHIVO
-- Un conductor registró la salida de un vehículo y su teléfono se apagó. Al
-- volver, el sistema le impedía iniciar otra inspección —correctamente— pero no
-- le ofrecía forma de registrar el regreso: el formulario sólo aparecía en el
-- dispositivo que había registrado la salida, identificado por un valor del
-- navegador. Perdido ese valor, el conductor quedaba bloqueado hasta que un
-- administrador anulara la inspección.
--
-- Lo que se prueba aquí es que el bloqueo SIGUE existiendo (es correcto) pero
-- que ahora viene acompañado de la salida: `claim_driver` devuelve cuál es la
-- operación abierta, y `register_return` la cierra desde cualquier dispositivo.
--
--   psql "$DATABASE_URL" -f supabase/tests/regreso.test.sql
--
-- Todo dentro de una transacción que se REVIERTE.
-- =============================================================================

begin;

create temp table qa(orden int, paso text, obtenido text, esperado text);
create temp table ids(conductor uuid, vehiculo uuid, inspeccion uuid);

select set_config('request.jwt.claims',
  json_build_object('sub', (select id::text from public.profiles
                             where role in ('operator','admin','superadmin') and active limit 1),
                    'role','authenticated')::text, true);

insert into ids(conductor, vehiculo)
select (select id from public.drivers where active order by full_name limit 1),
       (select id from public.vehicles where status='active' order by plate limit 1);

-- PIN conocido sólo dentro de esta transacción.
update public.drivers set pin_hash = extensions.crypt('4321', extensions.gen_salt('bf'))
 where id = (select conductor from ids);

-- Se le abre una operación: sale y no registra el regreso.
--
-- Se crea SIEMPRE una operación nueva en lugar de reaprovechar la que hubiera
-- en la base: reutilizar el estado del día hacía que la prueba dependiera de
-- kilometrajes ajenos y fallara por un motivo que no era el que se prueba.
delete from public.driver_claims where driver_id = (select conductor from ids);
update public.inspections set operation_status='closed'
 where driver_id = (select conductor from ids) and operation_status='open';
update public.inspections set operation_status='closed'
 where vehicle_id = (select vehiculo from ids) and operation_status='open';
-- El vehículo elegido puede tener ya una inspección viva de la ronda en curso:
-- se marca como liberada para que la de esta prueba pueda ocupar su sitio.
update public.inspections set released = true
 where vehicle_id = (select vehiculo from ids) and released = false;

with nueva as (
  insert into public.inspections(organization_id, round_id, vehicle_id, driver_id, vehicle_plate,
    driver_name, status, operation_status, km_inicial, submitted_at, created_at)
  select o.id,
         (select id from public.rounds where organization_id=o.id and status='open'
           order by round_number desc limit 1),
         i.vehiculo, i.conductor, v.plate, d.full_name,
         'authorized', 'open', 10000, now(), now()
    from ids i
    join public.vehicles v on v.id = i.vehiculo
    join public.drivers d on d.id = i.conductor
    join public.organizations o on o.id = v.organization_id
  returning id
)
update ids set inspeccion = (select id from nueva);

-- ------------------------------------------------------------ el bloqueo ----
insert into qa select 1, 'el conductor con vehiculo en ruta sigue bloqueado',
  (public.claim_driver((select conductor from ids), '4321', 'otro-telefono', 'iPhone')->>'motivo'),
  'en_ruta';

insert into qa select 2, 'el PIN incorrecto no destapa nada',
  (public.claim_driver((select conductor from ids), '0000', 'otro-telefono', 'iPhone')->>'motivo'),
  'pin';

-- --------------------------------------------------------------- la salida --
insert into qa select 3, 'se indica CUAL operacion hay que cerrar',
  case when (public.claim_driver((select conductor from ids), '4321', 'otro-telefono', 'iPhone')->>'inspeccion')
            = (select inspeccion::text from ids)
       then 'la correcta' else 'otra o ninguna' end,
  'la correcta';

insert into qa select 4, 'se indica la placa para poder nombrarla',
  case when (public.claim_driver((select conductor from ids), '4321', 'otro-telefono', 'iPhone')->>'placa') is not null
       then 'si' else 'no' end, 'si';

-- La permanencia mínima es política de empresa y aquí estorba: lo que se
-- prueba es que el regreso pueda cerrarse desde OTRO equipo, no cuánto tiempo
-- debe durar una operación. Eso tiene su propia suite en ciclo_operacion.
-- (El kilometraje sí se deja realista: 250 km. El tope de plausibilidad de la
--  migración 0027 rechaza los 90.000 km que usaba esta prueba antes, y con
--  razón: ningún vehículo recorre eso en una salida.)
update public.organizations set min_operacion_segundos = 0
 where id = (select organization_id from public.drivers where id=(select conductor from ids));

-- Desde la migración 0027 el regreso exige prueba de identidad: la reserva que
-- acaba de crear `claim_driver` en este mismo teléfono. Es justo lo que hace
-- posible cerrar desde un equipo distinto sin abrir un agujero.
insert into qa select 5, 'el regreso se cierra desde un dispositivo distinto',
  (public.register_return((select inspeccion from ids), 10250, 'lleno', 'otro-telefono')->>'status'), 'closed';

insert into qa select 6, 'cerrado el regreso, el perfil vuelve a estar libre',
  (public.claim_driver((select conductor from ids), '4321', 'otro-telefono', 'iPhone')->>'ok'), 'true';

insert into qa select 7, 'la reserva del perfil quedo liberada al cerrar',
  (select count(*)::text from public.driver_claims
    where driver_id = (select conductor from ids) and device_id <> 'otro-telefono'), '0';

-- ------------------------------------------------------------- resultados ---
select orden, paso, coalesce(obtenido,'(null)') as obtenido, esperado,
       case when coalesce(obtenido,'(null)') = esperado then 'OK' else '>>> FALLA' end as veredicto
  from qa order by orden;

rollback;
