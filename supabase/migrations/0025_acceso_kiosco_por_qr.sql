-- =============================================================================
-- 0025 — El QR abre el kiosco sin pasar por la pantalla de acceso
-- =============================================================================
-- QUÉ CAMBIA Y POR QUÉ
--
-- Hasta ahora el QR llevaba sólo la dirección del kiosco, sin credencial, y el
-- razonamiento estaba escrito en `app/admin/qr/page.tsx`: un cartel a la vista
-- de todos no debe ser una contraseña pegada a la pared. Eso daba por supuesto
-- que el kiosco es la TABLETA DEL PATIO, con la sesión abierta una sola vez.
--
-- El uso real es otro: los conductores escanean con SU PROPIO teléfono. Ahí
-- exigir el correo y la contraseña del operador es justo lo contrario de lo que
-- hace falta, porque obligaría a repartir esa contraseña entre todos ellos, que
-- es mucho peor que lo que este cambio arriesga.
--
-- EL COMPROMISO, DICHO SIN ADORNOS
-- A partir de aquí el cartel SÍ es una credencial. Quien lo fotografíe puede
-- abrir el kiosco de esa empresa y ver la lista de conductores y las placas.
-- Lo que NO puede hacer es registrar nada: para eso sigue haciendo falta el PIN
-- personal del conductor, que no está en ningún cartel. Y el token es rotable:
-- si un cartel se filtra, se genera otro desde el panel y el anterior muere.
--
-- CÓMO ESTÁ HECHO
-- Cada empresa tiene un usuario de kiosco propio en Supabase Auth, con rol
-- `operator`. El token del QR ES la contraseña de ese usuario. Así el acceso
-- viaja por el mismo camino que cualquier otro inicio de sesión —con su límite
-- de intentos y su comparación en tiempo constante— y ni RLS, ni
-- `app.current_org()`, ni un solo RPC necesitan cambiar: para la base de datos
-- es un operador más.
--
-- El token se guarda cifrado con la misma llave que los PIN, para que el cartel
-- pueda volver a imprimirse sin rotarlo, y revelarlo queda auditado.
-- =============================================================================

begin;

create table if not exists app.kiosk_access (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  email           text not null unique,
  token_cifrado   bytea not null,
  rotated_at      timestamptz not null default now(),
  rotated_by      uuid references public.profiles(id) on delete set null
);

comment on table app.kiosk_access is
  'Credencial del QR de cada empresa. Vive en el esquema `app`, que PostgREST no expone.';

revoke all on app.kiosk_access from anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.provision_kiosk_user — crea (o reutiliza) el usuario de kiosco y le fija
-- la contraseña. Interna: nadie la llama desde fuera.
-- ---------------------------------------------------------------------------
create or replace function app.provision_kiosk_user(p_org_id uuid, p_token text)
returns text
language plpgsql security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $fn$
declare
  v_slug  text;
  v_email text;
  v_uid   uuid;
begin
  select slug into v_slug from public.organizations where id = p_org_id;
  if v_slug is null then
    raise exception 'La empresa no existe';
  end if;

  -- Dominio reservado: estas cuentas no reciben correo ni deben poder
  -- recuperar contraseña por email. Su única llave es el token del cartel.
  v_email := 'kiosco.' || v_slug || '@kiosco.invalid';

  select id into v_uid from auth.users where email = v_email;

  if v_uid is null then
    v_uid := extensions.gen_random_uuid();
    insert into auth.users(
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token)
    values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email, extensions.crypt(p_token, extensions.gen_salt('bf', 10)),
      now(), now(), now(),
      '{"provider":"email","providers":["email"],"kiosco":true}',
      jsonb_build_object('full_name', 'Kiosco'),
      '', '', '', '', '', '');

    insert into auth.identities(provider_id, user_id, identity_data, provider,
                                last_sign_in_at, created_at, updated_at)
    values (v_email, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now());

    insert into public.profiles(id, organization_id, role, full_name, email)
    values (v_uid, p_org_id, 'operator', 'Kiosco', v_email);
  else
    update auth.users
       set encrypted_password = extensions.crypt(p_token, extensions.gen_salt('bf', 10)),
           updated_at = now()
     where id = v_uid;
  end if;

  return v_email;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- rotate_kiosk_access — genera un token nuevo e invalida el anterior
-- ---------------------------------------------------------------------------
create or replace function public.rotate_kiosk_access()
returns json
language plpgsql security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $fn$
declare
  v_org   uuid := app.current_org();
  v_token text;
  v_email text;
begin
  if not app.has_role('admin', 'superadmin') then
    raise exception 'Sólo un administrador puede regenerar el acceso del kiosco';
  end if;
  if v_org is null then
    raise exception 'No hay empresa activa';
  end if;

  -- 32 bytes de aleatoriedad en base64url: sin caracteres que una URL tenga
  -- que escapar y sin nada que se pueda adivinar.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_email := app.provision_kiosk_user(v_org, v_token);

  insert into app.kiosk_access(organization_id, email, token_cifrado, rotated_at, rotated_by)
  values (v_org, v_email, extensions.pgp_sym_encrypt(v_token, app.pin_key()), now(), auth.uid())
  on conflict (organization_id) do update
    set email = excluded.email,
        token_cifrado = excluded.token_cifrado,
        rotated_at = now(),
        rotated_by = auth.uid();

  perform app.write_audit('kiosk_access_rotated', 'organization', v_org::text, null, null, null);

  return json_build_object('ok', true, 'token', v_token);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- kiosk_access_token — el token vigente, para poder reimprimir el cartel
-- ---------------------------------------------------------------------------
-- Devuelve null si la empresa todavía no tiene acceso generado, para que la
-- pantalla ofrezca generarlo en vez de mostrar un cartel que no funciona.
create or replace function public.kiosk_access_token()
returns json
language plpgsql security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $fn$
declare
  v_org uuid := app.current_org();
  v_fila app.kiosk_access;
begin
  if not app.has_role('admin', 'superadmin') then
    raise exception 'Sólo un administrador puede ver el acceso del kiosco';
  end if;

  select * into v_fila from app.kiosk_access where organization_id = v_org;
  if not found then
    return json_build_object('configurado', false);
  end if;

  perform app.write_audit('kiosk_access_revealed', 'organization', v_org::text, null, null, null);

  return json_build_object(
    'configurado', true,
    'token', extensions.pgp_sym_decrypt(v_fila.token_cifrado, app.pin_key()),
    'rotado_en', v_fila.rotated_at);
end;
$fn$;

revoke all on function public.rotate_kiosk_access()  from public, anon;
revoke all on function public.kiosk_access_token()   from public, anon;
grant execute on function public.rotate_kiosk_access() to authenticated;
grant execute on function public.kiosk_access_token()  to authenticated;

-- `provision_kiosk_user` es interna: sólo la llaman las dos anteriores.
revoke all on function app.provision_kiosk_user(uuid, text) from public, anon, authenticated;

commit;
