-- 0020 — Un usuario puede pertenecer a varias empresas y cambiar entre ellas.
--
-- POR QUÉ
-- Un cliente con tres empresas necesitaba tres cuentas y cerrar sesión para
-- pasar de una a otra. Funciona, pero se siente como tres instalaciones
-- distintas en vez de un producto.
--
-- CÓMO, SIN TOCAR LA SEGURIDAD
-- Las 25 políticas RLS y los 33 RPC del sistema no consultan la tabla de
-- perfiles: todos preguntan por `app.current_org()`. Basta con cambiar de dónde
-- sale esa respuesta —de "la empresa del perfil" a "la empresa activa, validada
-- contra las pertenencias"— para que el sistema entero pase a ser multiempresa
-- por usuario. Ni una política ni un RPC cambian, así que el aislamiento entre
-- empresas sigue siendo exactamente el mismo código ya probado.
--
-- EL KIOSCO NO CAMBIA, A PROPÓSITO
-- La tableta de la portería de una empresa pertenece a esa empresa y sólo debe
-- ver sus conductores. Su cuenta de operador tendrá una única pertenencia, así
-- que para el kiosco no hay nada que elegir.

-- ---------------------------------------------------------------------------
-- Pertenencias: qué usuario entra a qué empresa, y con qué rol en cada una.
-- ---------------------------------------------------------------------------
create table if not exists public.organization_members (
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role            app.user_role not null,
  created_at      timestamptz not null default now(),
  primary key (profile_id, organization_id)
);

create index if not exists idx_org_members_org on public.organization_members(organization_id);

comment on table public.organization_members is
  'Empresas a las que entra cada usuario. El rol es POR EMPRESA: se puede ser '
  'administrador en una y supervisor en otra.';

-- Se rellena con lo que ya existe: nadie pierde el acceso que tenía.
insert into public.organization_members(profile_id, organization_id, role)
select id, organization_id, role from public.profiles
on conflict (profile_id, organization_id) do nothing;

alter table public.organization_members enable row level security;

drop policy if exists org_members_select on public.organization_members;
create policy org_members_select on public.organization_members
  for select to authenticated
  using (profile_id = auth.uid() or organization_id = app.current_org());

-- Cada perfil conserva su empresa de origen y añade la que está mirando ahora.
alter table public.profiles
  add column if not exists active_organization_id uuid
    references public.organizations(id) on delete set null;

comment on column public.profiles.active_organization_id is
  'Empresa que el usuario está viendo. NULL = la suya de origen. Se valida '
  'siempre contra organization_members: apuntar aquí a una empresa ajena no da acceso.';

-- Que la pertenencia no se pueda quedar atrás respecto al perfil.
create or replace function app.sincronizar_pertenencia()
returns trigger
language plpgsql security definer
set search_path to 'public','app','pg_temp'
as $$
begin
  insert into public.organization_members(profile_id, organization_id, role)
  values (new.id, new.organization_id, new.role)
  on conflict (profile_id, organization_id) do update set role = excluded.role;
  return new;
end; $$;

drop trigger if exists trg_sincronizar_pertenencia on public.profiles;
create trigger trg_sincronizar_pertenencia
  after insert or update of organization_id, role on public.profiles
  for each row execute function app.sincronizar_pertenencia();

-- ---------------------------------------------------------------------------
-- El único cambio de fondo: de dónde sale la empresa activa.
-- ---------------------------------------------------------------------------
create or replace function app.current_org()
returns uuid
language sql stable security definer
set search_path to 'public','app','pg_temp'
as $$
  select coalesce(
    -- La empresa elegida, sólo si de verdad pertenece a ella.
    (select p.active_organization_id
       from public.profiles p
      where p.id = auth.uid() and p.active
        and exists (select 1 from public.organization_members m
                     where m.profile_id = p.id
                       and m.organization_id = p.active_organization_id)),
    -- Si no ha elegido ninguna, la suya de origen. Comportamiento de siempre.
    (select organization_id from public.profiles where id = auth.uid() and active)
  );
$$;

-- El rol pasa a ser el que se tiene EN LA EMPRESA ACTIVA.
create or replace function app.has_role(variadic roles app.user_role[])
returns boolean
language sql stable security definer
set search_path to 'public','app','pg_temp'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and coalesce(
            (select m.role from public.organization_members m
              where m.profile_id = p.id and m.organization_id = app.current_org()),
            p.role   -- red de seguridad: sin pertenencia, el rol del perfil
          ) = any(roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- Cambiar de empresa
-- ---------------------------------------------------------------------------
create or replace function public.switch_organization(p_org_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public','app','pg_temp'
as $$
declare v_nombre text;
begin
  if not exists (select 1 from public.organization_members
                  where profile_id = auth.uid() and organization_id = p_org_id) then
    raise exception 'No tienes acceso a esa empresa';
  end if;

  select name into v_nombre from public.organizations where id = p_org_id;

  update public.profiles set active_organization_id = p_org_id where id = auth.uid();

  perform app.write_audit('organization_switched','organization',p_org_id::text,
    null, jsonb_build_object('empresa', v_nombre), null);

  return jsonb_build_object('ok', true, 'organization_id', p_org_id, 'nombre', v_nombre);
end; $$;

revoke all on function public.switch_organization(uuid) from public;
grant execute on function public.switch_organization(uuid) to authenticated;

-- Empresas a las que puede entrar quien pregunta.
create or replace function public.my_organizations()
returns table(id uuid, name text, role app.user_role, activa boolean)
language sql stable security definer
set search_path to 'public','app','pg_temp'
as $$
  select o.id, o.name, m.role, (o.id = app.current_org()) as activa
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.profile_id = auth.uid()
  order by o.name;
$$;

revoke all on function public.my_organizations() from public;
grant execute on function public.my_organizations() to authenticated;
