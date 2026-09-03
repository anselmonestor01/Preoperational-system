-- =============================================================================
-- MUNDO MARÍTIMO — Migración 0009 (FASE 2)
-- Revelado seguro del PIN del conductor.
--   - El PIN NUNCA se guarda en texto plano.
--   - Verificación sigue usando bcrypt (pin_hash).
--   - Se guarda ADEMÁS una copia cifrada (pgp_sym) con una clave en Vault.
--   - reveal_driver_pin descifra bajo demanda, sólo para admin, y queda AUDITADO.
-- =============================================================================

-- Clave de cifrado en Vault (se crea una sola vez).
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'mm_pin_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'mm_pin_key',
      'Clave de cifrado de PIN de conductores (Mundo Marítimo)');
  end if;
end $$;

-- Acceso a la clave sólo desde funciones definer (no expuesto a clientes).
create or replace function app.pin_key()
returns text language sql stable security definer
set search_path = vault, pg_temp as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'mm_pin_key' limit 1;
$$;

-- Columna cifrada.
alter table public.drivers add column if not exists pin_encrypted bytea;

-- Recrear admin_create_driver: guarda hash + cifrado.
create or replace function public.admin_create_driver(
  p_full_name text, p_license text, p_whatsapp text, p_pin text)
returns uuid language plpgsql security definer
set search_path = public, app, extensions, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then raise exception 'No autorizado'; end if;
  if p_pin is not null and p_pin !~ '^\d{4}$' then raise exception 'El PIN debe tener 4 dígitos'; end if;
  insert into public.drivers(organization_id, full_name, license, whatsapp, pin_hash, pin_encrypted, created_by)
    values (v_org, p_full_name, coalesce(p_license,''), coalesce(p_whatsapp,''),
      case when p_pin is not null then extensions.crypt(p_pin, extensions.gen_salt('bf')) else null end,
      case when p_pin is not null then extensions.pgp_sym_encrypt(p_pin, app.pin_key()) else null end,
      auth.uid())
    returning id into v_id;
  perform app.write_audit('driver_created','driver',v_id::text,null,
    jsonb_build_object('full_name',p_full_name),null);
  return v_id;
end; $$;

-- Recrear set_driver_pin: guarda hash + cifrado.
create or replace function public.set_driver_pin(p_driver_id uuid, p_pin text)
returns void language plpgsql security definer
set search_path = public, app, extensions, pg_temp as $$
declare v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then raise exception 'No autorizado'; end if;
  if p_pin is null or p_pin !~ '^\d{4}$' then raise exception 'El PIN debe tener 4 dígitos'; end if;
  update public.drivers set
    pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
    pin_encrypted = extensions.pgp_sym_encrypt(p_pin, app.pin_key()),
    updated_at = now()
    where id=p_driver_id and organization_id=v_org;
  if not found then raise exception 'Conductor no encontrado'; end if;
  perform app.write_audit('driver_pin_changed','driver',p_driver_id::text,null,null,null);
end; $$;

-- Revelar PIN: sólo admin/superadmin, auditado.
create or replace function public.reveal_driver_pin(p_driver_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, app, extensions, pg_temp as $$
declare v_org uuid; v_enc bytea; v_pin text; v_name text;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then raise exception 'No autorizado'; end if;
  select pin_encrypted, full_name into v_enc, v_name
    from public.drivers where id=p_driver_id and organization_id=v_org;
  if not found then raise exception 'Conductor no encontrado'; end if;
  if v_enc is null then return jsonb_build_object('has_pin', false); end if;
  v_pin := extensions.pgp_sym_decrypt(v_enc, app.pin_key());
  perform app.write_audit('driver_pin_revealed','driver',p_driver_id::text,null,
    jsonb_build_object('driver', v_name), null);
  return jsonb_build_object('has_pin', true, 'pin', v_pin);
end; $$;

revoke execute on function public.reveal_driver_pin(uuid) from public, anon;
grant execute on function public.reveal_driver_pin(uuid) to authenticated;

-- Aquí había un backfill de la copia cifrada para los conductores demo, con sus
-- seis PIN escritos en claro. Se retiró: publicaba PIN adivinables en un
-- repositorio público, y desde que el sembrado los genera al azar tampoco
-- habría acertado ninguno. En una base ya migrada esta sentencia ya se
-- ejecutó; en una nueva no tiene a quién aplicarse, porque los conductores se
-- crean después. En ambos casos quitarla no cambia nada salvo la fuga.
