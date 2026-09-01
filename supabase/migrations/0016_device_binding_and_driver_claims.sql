-- 0016 — Vinculación por dispositivo y bloqueo de perfil en uso
-- =============================================================================
-- Problemas que resuelve:
--  1. Un mismo conductor "inspeccionando" dos vehículos a la vez desde dos
--     teléfonos: imposible en la realidad, y falsea el historial.
--  2. Cualquier conductor podía cerrar el regreso de CUALQUIER vehículo,
--     porque el formulario mostraba todas las operaciones abiertas.
--
-- El identificador de dispositivo NO es un control de seguridad: se guarda en
-- el propio teléfono y puede borrarse. Es un control de INTEGRIDAD OPERATIVA,
-- que evita confusiones y solapamientos. La autorización real la siguen dando
-- el rol y las políticas RLS.

-- Qué dispositivo registró cada inspección.
alter table public.inspections
  add column if not exists device_id text;

create index if not exists idx_inspections_device_id
  on public.inspections(device_id) where device_id is not null;

-- ---------------------------------------------------------------------------
-- Reserva de perfil de conductor
-- ---------------------------------------------------------------------------
create table if not exists public.driver_claims (
  driver_id       uuid primary key references public.drivers(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id       text not null,
  device_label    text,
  claimed_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

alter table public.driver_claims enable row level security;

drop policy if exists claims_select on public.driver_claims;
create policy claims_select on public.driver_claims
  for select to authenticated
  using (organization_id = app.current_org());

comment on table public.driver_claims is
  'Perfil de conductor en uso por un dispositivo. Impide que dos teléfonos '
  'inspeccionen con la misma identidad al mismo tiempo. Caduca por inactividad.';

-- ---------------------------------------------------------------------------
-- Verificar el PIN Y reservar el perfil en un solo paso atómico.
-- Reemplaza a verify_driver_pin en el flujo del kiosco.
-- ---------------------------------------------------------------------------
create or replace function public.claim_driver(
  p_driver_id uuid, p_pin text, p_device_id text, p_device_label text default null)
returns jsonb language plpgsql security definer
set search_path = public, app, extensions, pg_temp as $$
declare
  v_org uuid; v_hash text; v_name text; v_claim public.driver_claims;
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

-- Liberar la reserva (al terminar o cancelar la inspección).
create or replace function public.release_driver_claim(p_driver_id uuid, p_device_id text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null then raise exception 'No autorizado'; end if;
  delete from public.driver_claims
    where driver_id = p_driver_id and organization_id = v_org and device_id = p_device_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ---------------------------------------------------------------------------
-- Vincular una inspección al dispositivo que la registró.
-- (La migración 0018 la reemplaza por una versión que guarda además la
--  descripción legible del equipo.)
-- ---------------------------------------------------------------------------
create or replace function public.bind_inspection_device(
  p_inspection_id uuid, p_device_id text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null then raise exception 'No autorizado'; end if;
  update public.inspections
    set device_id = nullif(btrim(p_device_id), '')
    where id = p_inspection_id and organization_id = v_org and device_id is null;
  return jsonb_build_object('ok', found);
end; $$;

revoke execute on function public.claim_driver(uuid,text,text,text) from public, anon;
revoke execute on function public.release_driver_claim(uuid,text) from public, anon;
revoke execute on function public.bind_inspection_device(uuid,text) from public, anon;
grant execute on function public.claim_driver(uuid,text,text,text) to authenticated;
grant execute on function public.release_driver_claim(uuid,text) to authenticated;
grant execute on function public.bind_inspection_device(uuid,text) to authenticated;
