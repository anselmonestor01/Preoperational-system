-- =============================================================================
-- PREOPERATIONAL SYSTEM — Carrera real entre dos sesiones simultáneas
-- =============================================================================
-- POR QUÉ ESTE ARCHIVO NO ESTÁ EN ciclo_operacion.test.sql
--
-- Las demás pruebas corren en UNA sola sesión. Eso basta para casi todo, pero
-- no para el fallo que originó las migraciones 0027 y 0028: la regla "un
-- conductor, una operación" vivía en un `select … limit 1` sin cerrojo, y una
-- comprobación así sólo se rompe cuando DOS transacciones la ejecutan a la vez
-- sin verse la una a la otra. Simularlo desde una sola sesión demuestra que el
-- índice funciona, pero no que la carrera existía. Aquí se abren dos conexiones
-- de verdad, con `dblink`, y se solapan a propósito.
--
-- RESULTADO MEDIDO (05/09/2026, base del proyecto)
--
--   SIN el arreglo (índice retirado y disparador 0019 restaurado):
--     Sesión A .................. ACEPTADA
--     Sesión B .................. ACEPTADA
--     Estado de B mientras A no confirmaba ...... Client / ClientRead
--                                                 (no esperó: siguió de largo)
--     Vehículos en ruta del mismo conductor ..... 2  (QA-CARRERA-1 + QA-CARRERA-2)
--
--   CON el arreglo:
--     Sesión A .................. authorized
--     Sesión B .................. RECHAZADA: «Este conductor tiene el vehículo
--                                 QA-CARRERA-1 en ruta desde las 01:40 …»
--     Estado de B mientras A no confirmaba ...... Lock / advisory
--                                                 (esperó al cerrojo de A)
--     Vehículos en ruta del mismo conductor ..... 1
--
-- CÓMO SE EJECUTA
--   Necesita dos conexiones reales, y `dblink` exige contraseña. Se crea un rol
--   temporal sólo para la prueba y se elimina al final. La contraseña se pasa
--   por parámetro y NO se guarda en el repositorio:
--
--     psql "$DATABASE_URL" \
--       -v host="db.<ref>.supabase.co" \
--       -v clave="$(openssl rand -hex 16)" \
--       -f supabase/tests/concurrencia.test.sql
--
--   El montaje se CONFIRMA (no puede ir dentro de una transacción: las otras
--   sesiones no verían datos sin confirmar), así que el archivo termina
--   retirando todo lo que creó. Si algo se interrumpe a medias, el bloque final
--   de limpieza se puede volver a ejecutar por separado; es idempotente.
-- =============================================================================

\set ON_ERROR_STOP on

-- Los dos parámetros llegan por línea de órdenes y se dejan disponibles para
-- el bloque PL/pgSQL, que no puede leer variables de psql directamente.
select set_config('qa.host',  :'host',  false),
       set_config('qa.clave', :'clave', false);

-- ------------------------------------------------------------------ montaje --
create extension if not exists dblink with schema extensions;

insert into public.vehicles(organization_id, plate, reference, status)
select id, 'QA-CARRERA-1', 'Banco de pruebas de concurrencia', 'active' from public.organizations limit 1
on conflict (organization_id, plate) do nothing;
insert into public.vehicles(organization_id, plate, reference, status)
select id, 'QA-CARRERA-2', 'Banco de pruebas de concurrencia', 'active' from public.organizations limit 1
on conflict (organization_id, plate) do nothing;

insert into public.drivers(organization_id, full_name, pin_hash, active)
select o.id, 'QA Carrera', extensions.crypt('0000', extensions.gen_salt('bf')), true
from public.organizations o
where not exists (select 1 from public.drivers d where d.full_name = 'QA Carrera');

insert into public.driver_claims(driver_id, organization_id, device_id, device_label, claimed_at, expires_at)
select d.id, d.organization_id, 'qa-carrera', 'Banco de pruebas', now(), now() + interval '1 hour'
from public.drivers d where d.full_name = 'QA Carrera'
on conflict (driver_id) do update set device_id = 'qa-carrera', expires_at = now() + interval '1 hour';

-- Rol efímero: `dblink` no admite conectarse sin contraseña, y el rol de la
-- aplicación no la tiene. Se retira al final del archivo.
select format('create role qa_carrera_0027 login password %L', :'clave')
where not exists (select 1 from pg_roles where rolname = 'qa_carrera_0027') \gexec
grant authenticated to qa_carrera_0027;

-- --------------------------------------------------------------- la carrera --
do $blk$
declare
  v_conn text := format('dbname=postgres host=%s port=5432 sslmode=require user=qa_carrera_0027 password=%s',
                        current_setting('qa.host'), current_setting('qa.clave'));
  v_claims text; v_tmp text;
  v_drv uuid; v1 uuid; v2 uuid; v_perfil uuid;
  v_a text; v_b text; v_abiertas int; v_espera text; v_placas text;
begin
  select id into v_drv from public.drivers where full_name = 'QA Carrera';
  select id into v1 from public.vehicles where plate = 'QA-CARRERA-1';
  select id into v2 from public.vehicles where plate = 'QA-CARRERA-2';
  select id into v_perfil from public.profiles
   where role in ('operator','admin','superadmin') and active limit 1;
  v_claims := json_build_object('sub', v_perfil::text, 'role', 'authenticated')::text;

  perform extensions.dblink_connect('sa', v_conn);
  perform extensions.dblink_connect('sb', v_conn);
  select x.r into v_tmp from extensions.dblink('sa', format('select set_config(%L,%L,false)','request.jwt.claims',v_claims)) as x(r text);
  select x.r into v_tmp from extensions.dblink('sb', format('select set_config(%L,%L,false)','request.jwt.claims',v_claims)) as x(r text);

  -- A abre su operación y NO confirma: se queda con el cerrojo del conductor.
  perform extensions.dblink_exec('sa', 'begin');
  begin
    select x.r into v_a from extensions.dblink('sa', format(
      'select (public.submit_inspection(%L::uuid,%L::uuid,''[]''::jsonb,70000,''lleno'',''carrera A'',null,''qa-carrera''))->>''status''',
      v1, v_drv)) as x(r text);
  exception when others then v_a := 'RECHAZADA: ' || left(sqlerrm, 70); end;

  -- B intenta lo mismo con otro vehículo. Se envía SIN esperar la respuesta:
  -- con el arreglo puesto, aquí es donde se queda esperando.
  perform extensions.dblink_exec('sb', 'begin');
  perform extensions.dblink_send_query('sb', format(
    'select (public.submit_inspection(%L::uuid,%L::uuid,''[]''::jsonb,70000,''lleno'',''carrera B'',null,''qa-carrera''))->>''status''',
    v2, v_drv));

  -- La medida que distingue "esperó" de "pasó de largo".
  perform pg_sleep(2);
  select coalesce(string_agg(distinct coalesce(wait_event_type,'-')||' / '||coalesce(wait_event,'-'), ', '), 'sin sesión activa')
    into v_espera
  from pg_stat_activity
  where usename = 'qa_carrera_0027' and query like '%carrera B%' and query not like '%pg_stat_activity%';

  perform extensions.dblink_exec('sa', 'commit');

  begin
    select x.r into v_b from extensions.dblink_get_result('sb') as x(r text);
    v_b := 'ACEPTADA: ' || coalesce(v_b, 'sin resultado');
  exception when others then v_b := 'RECHAZADA: ' || left(sqlerrm, 70); end;
  begin perform extensions.dblink_get_result('sb'); exception when others then null; end;
  begin perform extensions.dblink_exec('sb', 'rollback'); exception when others then null; end;

  select count(*), coalesce(string_agg(vehicle_plate, ' + ' order by vehicle_plate), 'ninguno')
    into v_abiertas, v_placas
  from public.inspections where driver_id = v_drv and operation_status = 'open';

  perform extensions.dblink_disconnect('sa');
  perform extensions.dblink_disconnect('sb');

  create temp table carrera as
  select 1 n, 'Sesión A — primera en llegar' s, v_a d
  union all select 2, 'Sesión B — simultánea, mismo conductor, otro vehículo', v_b
  union all select 3, 'Estado de B mientras A seguía sin confirmar', v_espera
  union all select 4, 'Vehículos en ruta del mismo conductor al final', v_abiertas || ' (' || v_placas || ')';
end $blk$;

select s as "escenario", d as "resultado" from carrera order by n;

-- ------------------------------------------------------------- la limpieza --
-- Idempotente: se puede volver a ejecutar si la prueba se interrumpió a medias.
delete from public.inspections where obs_general in ('carrera A','carrera B');
delete from public.driver_claims where device_id = 'qa-carrera';
delete from public.inspections where vehicle_id in
  (select id from public.vehicles where plate in ('QA-CARRERA-1','QA-CARRERA-2'));
delete from public.vehicles where plate in ('QA-CARRERA-1','QA-CARRERA-2');
delete from public.drivers where full_name = 'QA Carrera';
drop role if exists qa_carrera_0027;
drop extension if exists dblink;

select 'banco de pruebas retirado' as estado,
       (select count(*) from pg_roles where rolname='qa_carrera_0027') as rol_temporal,
       (select count(*) from public.vehicles where plate like 'QA-CARRERA-%') as vehiculos,
       (select count(*) from public.drivers where full_name = 'QA Carrera') as conductores;
