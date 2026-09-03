-- =============================================================================
-- PREOPERATIONAL SYSTEM — Segunda cerradura de la consola de plataforma
-- =============================================================================
-- Igual que aislamiento.test.sql, este archivo hace `set local role authenticated`
-- para que las comprobaciones ocurran como las hace un usuario real y no como
-- `postgres`, que ignora RLS y permisos de tabla.
--
-- Lo que se prueba aquí es una sola afirmación, desde varios ángulos:
--   entrar a la consola exige DOS cosas —sesión de superadmin y clave— y
--   ninguna de las dos sirve por separado.
--
--   psql "$DATABASE_URL" -f supabase/tests/consola.test.sql
--
-- Todo dentro de una transacción que se REVIERTE.
-- =============================================================================

begin;

create temp table qa(orden numeric, paso text, resultado text, esperado text);
create temp table ids(jefe uuid, otro uuid, token uuid);
grant all on qa to authenticated;
grant all on ids to authenticated;

insert into ids(jefe)
select id from public.profiles
 where role in ('admin','superadmin') and active
 order by created_at limit 1;

-- El segundo usuario tiene que ser OTRO de verdad: si fuera el mismo, la mitad
-- de las comprobaciones pasarían sin comprobar nada.
update ids set otro = (
  select id from public.profiles
   where active and id <> (select jefe from ids)
   order by created_at desc limit 1);

do $$
begin
  if (select otro from ids) is null then
    raise exception 'Esta prueba necesita al menos dos perfiles activos';
  end if;
end $$;

update public.profiles set role='superadmin' where id = (select jefe from ids);
update public.profiles set role='admin'      where id = (select otro from ids);

-- Punto de partida limpio dentro de la transacción.
update app.platform_config set clave_hash = null where id = 1;
delete from app.platform_attempts;

-- ------------------------------------------------------- como NO superadmin --
select set_config('request.jwt.claims',
  json_build_object('sub', (select otro::text from ids), 'role','authenticated')::text, true);
set local role authenticated;

insert into qa values (1, 'RLS realmente activa',
  (select rolbypassrls from pg_roles where rolname = current_user)::text, 'false');

insert into qa values (2, 'un admin normal no esta autorizado a la consola',
  (select autorizado::text from public.console_state()), 'false');

do $$
begin
  perform public.open_console_session('lo-que-sea');
  insert into qa values (3, 'un admin normal no puede abrir consola', 'ABRIO', 'rechazado');
exception when others then
  insert into qa values (3, 'un admin normal no puede abrir consola', 'rechazado', 'rechazado');
end $$;

do $$
begin
  perform 1 from app.platform_config;
  insert into qa values (4, 'la tabla de la clave es inalcanzable desde el navegador', 'LEYO', 'sin permiso');
exception when insufficient_privilege then
  insert into qa values (4, 'la tabla de la clave es inalcanzable desde el navegador', 'sin permiso', 'sin permiso');
end $$;

-- ---------------------------------------------------------- como superadmin --
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select jefe::text from ids), 'role','authenticated')::text, true);
set local role authenticated;

insert into qa values (5, 'sin clave puesta, la consola se declara no configurada',
  (select configurada::text from public.console_state()), 'false');

insert into qa values (6, 'sin clave puesta no se puede abrir',
  (select (public.open_console_session('cualquiera')->>'motivo')), 'sin_clave');

do $$
begin
  perform public.set_console_password(null, 'Corta1');
  insert into qa values (7, 'clave corta rechazada', 'ACEPTO', 'rechazado');
exception when others then
  insert into qa values (7, 'clave corta rechazada', 'rechazado', 'rechazado');
end $$;

do $$
begin
  perform public.set_console_password(null, 'SoloLetrasSinNumero');
  insert into qa values (8, 'clave sin numeros rechazada', 'ACEPTO', 'rechazado');
exception when others then
  insert into qa values (8, 'clave sin numeros rechazada', 'rechazado', 'rechazado');
end $$;

insert into qa values (9, 'se establece la clave la primera vez',
  (select (public.set_console_password(null, 'ClaveDePrueba2026')->>'ok')), 'true');

insert into qa values (10, 'ya figura como configurada',
  (select configurada::text from public.console_state()), 'true');

insert into qa values (11, 'clave equivocada no abre',
  (select (public.open_console_session('ClaveEquivocada99')->>'motivo')), 'clave');

reset role;
insert into qa values (12, 'el intento fallido queda contado',
  (select count(*)::text from app.platform_attempts), '1');
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select jefe::text from ids), 'role','authenticated')::text, true);
set local role authenticated;

update ids set token = (public.open_console_session('ClaveDePrueba2026')->>'token')::uuid;

insert into qa values (13, 'la clave correcta entrega una sesion de consola',
  (select (token is not null)::text from ids), 'true');

reset role;
insert into qa values (14, 'el acierto borra los intentos fallidos',
  (select count(*)::text from app.platform_attempts), '0');
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select jefe::text from ids), 'role','authenticated')::text, true);
set local role authenticated;

insert into qa values (15, 'la sesion de consola es valida para su dueño',
  (select public.console_session_valid((select token from ids))::text), 'true');

insert into qa values (16, 'un token inventado no vale',
  (select public.console_session_valid('00000000-0000-0000-0000-000000000000')::text), 'false');

-- --------------------------------------- el token es de su dueño, de nadie más
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select otro::text from ids), 'role','authenticated')::text, true);
set local role authenticated;

insert into qa values (17, 'el token robado no sirve con otra sesion',
  (select public.console_session_valid((select token from ids))::text), 'false');

-- ------------------------------------------------------------- salir y cerrar
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select jefe::text from ids), 'role','authenticated')::text, true);
set local role authenticated;

insert into qa values (18, 'cerrar consola invalida el token',
  (select (public.close_console_session((select token from ids))->>'ok')), 'true');

insert into qa values (19, 'tras cerrar, el token ya no vale',
  (select public.console_session_valid((select token from ids))::text), 'false');

-- ------------------------------------------- cambiar la clave cierra todo ---
update ids set token = (public.open_console_session('ClaveDePrueba2026')->>'token')::uuid;

insert into qa values (20, 'se puede reabrir con la misma clave',
  (select public.console_session_valid((select token from ids))::text), 'true');

do $$
begin
  perform public.set_console_password('ClaveEquivocada99', 'ClaveNueva2027');
  insert into qa values (21, 'cambiar la clave exige la actual', 'CAMBIO', 'rechazado');
exception when others then
  insert into qa values (21, 'cambiar la clave exige la actual', 'rechazado', 'rechazado');
end $$;

insert into qa values (22, 'con la clave actual si se cambia',
  (select (public.set_console_password('ClaveDePrueba2026', 'ClaveNueva2027')->>'ok')), 'true');

insert into qa values (23, 'cambiar la clave cierra las consolas abiertas',
  (select public.console_session_valid((select token from ids))::text), 'false');

insert into qa values (24, 'la clave vieja ya no abre',
  (select (public.open_console_session('ClaveDePrueba2026')->>'motivo')), 'clave');

-- ------------------------------------------------------------- resultados ---
reset role;

select
  orden,
  paso,
  coalesce(resultado, '(null)') as obtenido,
  esperado,
  case when coalesce(resultado,'(null)') = esperado then 'OK' else '>>> FALLA' end as veredicto
from qa
order by orden;

select
  count(*) filter (where coalesce(resultado,'(null)') = esperado) as pasan,
  count(*) filter (where coalesce(resultado,'(null)') <> esperado) as fallan,
  count(*) as total
from qa;

rollback;
