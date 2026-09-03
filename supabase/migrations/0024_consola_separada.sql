-- =============================================================================
-- 0024 — La consola de plataforma sale del panel de administración
-- =============================================================================
-- Hasta ahora "Empresas" y "Plataforma" eran dos entradas más del menú lateral
-- del panel de cliente. Eso tiene tres problemas, y ninguno es estético:
--
--   1. Mezcla dos oficios. Quien administra la flota de UNA empresa y quien
--      administra la PLATAFORMA no hacen el mismo trabajo ni miran los mismos
--      números. Un menú compartido invita a confundirlos.
--
--   2. Una sola cerradura. La contraseña del correo del dueño abría a la vez la
--      operación de una empresa y el panorama de todas. Robada esa contraseña,
--      se pierde todo de una vez.
--
--   3. Superficie innecesaria. El panel de cliente se instala en tablets de
--      patio y computadores compartidos. La consola de plataforma no tiene por
--      qué estar a un clic de distancia en esos equipos.
--
-- Esta migración añade la SEGUNDA cerradura. Es aditiva, no sustitutiva: para
-- entrar a la consola hacen falta las dos cosas a la vez —una sesión de un
-- usuario con rol superadmin, Y la clave de consola—. Ni la clave sola ni la
-- sesión sola sirven de nada.
--
-- Todo vive en el esquema `app`, que PostgREST no expone: ni el hash de la
-- clave ni los identificadores de sesión son alcanzables desde el navegador
-- bajo ninguna circunstancia. Sólo estas funciones, que corren como su dueño,
-- los tocan.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Clave de consola (una sola, para la plataforma entera)
-- ---------------------------------------------------------------------------
create table if not exists app.platform_config (
  id         smallint primary key default 1 check (id = 1),
  clave_hash text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on table app.platform_config is
  'Clave de la consola de plataforma. Se guarda como hash bcrypt: ni el dueño puede recuperarla, sólo reemplazarla.';

insert into app.platform_config (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Sesiones de consola
-- ---------------------------------------------------------------------------
-- El identificador de sesión viaja en una cookie httpOnly: el JavaScript de la
-- página nunca lo ve. Y está atado a `profile_id`, así que una cookie robada no
-- sirve sin robar además la sesión de Supabase del mismo usuario.
create table if not exists app.platform_sessions (
  id         uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists idx_platform_sessions_vivas
  on app.platform_sessions (profile_id, expires_at desc)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Intentos fallidos (freno a la fuerza bruta)
-- ---------------------------------------------------------------------------
create table if not exists app.platform_attempts (
  id         bigserial primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  at         timestamptz not null default now()
);

create index if not exists idx_platform_attempts on app.platform_attempts (profile_id, at desc);

-- Nadie que no sea el dueño de las funciones toca estas tablas.
revoke all on app.platform_config   from anon, authenticated;
revoke all on app.platform_sessions from anon, authenticated;
revoke all on app.platform_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- console_state — ¿hay clave puesta? ¿este usuario puede siquiera intentarlo?
-- ---------------------------------------------------------------------------
create or replace function public.console_state()
returns table (configurada boolean, autorizado boolean)
language sql stable security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
  select
    coalesce((select clave_hash is not null from app.platform_config where id = 1), false),
    app.has_role('superadmin');
$$;

comment on function public.console_state() is
  'Si la consola ya tiene clave y si quien pregunta puede usarla. No revela el hash.';

-- ---------------------------------------------------------------------------
-- set_console_password — establecer o cambiar la clave
-- ---------------------------------------------------------------------------
-- La primera vez `p_actual` se ignora: no hay clave anterior que comprobar. A
-- partir de ahí es obligatoria, para que una sesión abierta y olvidada en un
-- equipo ajeno no permita cambiarla sin conocerla.
create or replace function public.set_console_password(p_actual text, p_nueva text)
returns json
language plpgsql security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
declare
  v_hash text;
begin
  if not app.has_role('superadmin') then
    raise exception 'Sólo el superadministrador puede cambiar la clave de la consola';
  end if;

  if p_nueva is null or length(p_nueva) < 12 then
    raise exception 'La clave de la consola debe tener al menos 12 caracteres';
  end if;
  if p_nueva !~ '[[:alpha:]]' or p_nueva !~ '[[:digit:]]' then
    raise exception 'La clave debe combinar letras y números';
  end if;

  select clave_hash into v_hash from app.platform_config where id = 1;

  if v_hash is not null then
    if p_actual is null or extensions.crypt(p_actual, v_hash) <> v_hash then
      raise exception 'La clave actual no es correcta';
    end if;
  end if;

  update app.platform_config
     set clave_hash = extensions.crypt(p_nueva, extensions.gen_salt('bf', 12)),
         updated_at = now(),
         updated_by = auth.uid()
   where id = 1;

  -- Cambiar la clave cierra toda consola abierta en cualquier equipo. Es el
  -- único botón de pánico que existe si un portátil se pierde.
  update app.platform_sessions set revoked_at = now() where revoked_at is null;

  return json_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- open_console_session — canjear la clave por una sesión de 8 horas
-- ---------------------------------------------------------------------------
-- Devuelve JSON en vez de lanzar excepción cuando la clave es incorrecta, y
-- esto es deliberado: `raise exception` revierte la transacción entera, y con
-- ella el registro del intento fallido. Un contador que se borra a sí mismo no
-- frena una fuerza bruta. Los errores que NO son "clave incorrecta" sí se
-- lanzan, porque en esos no hay nada que contar.
create or replace function public.open_console_session(p_clave text)
returns json
language plpgsql security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_hash   text;
  v_fallos int;
  v_id     uuid;
begin
  if v_uid is null or not app.has_role('superadmin') then
    raise exception 'No tienes acceso a la consola de plataforma';
  end if;

  delete from app.platform_sessions where expires_at < now() - interval '7 days';
  delete from app.platform_attempts where at < now() - interval '1 day';

  select count(*) into v_fallos
    from app.platform_attempts
   where profile_id = v_uid and at > now() - interval '15 minutes';

  if v_fallos >= 5 then
    return json_build_object('ok', false, 'motivo', 'bloqueado',
      'mensaje', 'Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentarlo.');
  end if;

  select clave_hash into v_hash from app.platform_config where id = 1;
  if v_hash is null then
    return json_build_object('ok', false, 'motivo', 'sin_clave',
      'mensaje', 'La consola todavía no tiene clave. Debes establecerla la primera vez.');
  end if;

  if extensions.crypt(p_clave, v_hash) <> v_hash then
    insert into app.platform_attempts (profile_id) values (v_uid);
    return json_build_object('ok', false, 'motivo', 'clave',
      'mensaje', 'La clave de consola no es correcta.',
      'restantes', greatest(0, 4 - v_fallos));
  end if;

  delete from app.platform_attempts where profile_id = v_uid;

  insert into app.platform_sessions (profile_id, expires_at)
       values (v_uid, now() + interval '8 hours')
    returning id into v_id;

  return json_build_object('ok', true, 'token', v_id,
    'expira', to_char(timezone('America/Bogota', now() + interval '8 hours'), 'HH12:MI AM'));
end;
$$;

-- ---------------------------------------------------------------------------
-- console_session_valid — la comprobación que corre en CADA pantalla
-- ---------------------------------------------------------------------------
-- Exige las dos cosas a la vez: token vivo Y que el dueño del token sea quien
-- está pidiendo la página ahora mismo.
create or replace function public.console_session_valid(p_token uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
  select app.has_role('superadmin')
     and exists (
       select 1 from app.platform_sessions s
        where s.id = p_token
          and s.profile_id = auth.uid()
          and s.revoked_at is null
          and s.expires_at > now()
     );
$$;

-- ---------------------------------------------------------------------------
-- close_console_session — salir de la consola sin cerrar la sesión del correo
-- ---------------------------------------------------------------------------
create or replace function public.close_console_session(p_token uuid)
returns json
language plpgsql security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
begin
  update app.platform_sessions
     set revoked_at = now()
   where id = p_token and profile_id = auth.uid() and revoked_at is null;
  return json_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke all on function public.console_state()                        from public, anon;
revoke all on function public.set_console_password(text, text)       from public, anon;
revoke all on function public.open_console_session(text)             from public, anon;
revoke all on function public.console_session_valid(uuid)            from public, anon;
revoke all on function public.close_console_session(uuid)            from public, anon;

grant execute on function public.console_state()                     to authenticated;
grant execute on function public.set_console_password(text, text)    to authenticated;
grant execute on function public.open_console_session(text)          to authenticated;
grant execute on function public.console_session_valid(uuid)         to authenticated;
grant execute on function public.close_console_session(uuid)         to authenticated;

commit;
