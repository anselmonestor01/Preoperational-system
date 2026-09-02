-- 0021 — Crear empresas desde la interfaz, no con SQL a mano.
--
-- POR QUÉ IMPORTA MÁS DE LO QUE PARECE
-- No es sólo comodidad. La batería de pruebas descubrió en su día que NINGÚN
-- ítem del checklist estaba marcado como crítico de seguridad, de modo que el
-- sistema autorizaba la salida de un camión con los frenos en mal estado. Si
-- cada empresa nueva se monta a mano, ese fallo puede repetirse en cada una y
-- nadie se entera hasta que pase algo.
--
-- Esta función copia el catálogo de una empresa PLANTILLA íntegro, con sus
-- marcas de criticidad, y publica la versión 1 del checklist en el mismo paso.
-- Una empresa nueva no puede nacer sin esas marcas.

create or replace function public.create_organization(
  p_nombre       text,
  p_zona_horaria text default 'America/Bogota',
  p_max_fallas   int  default 3,
  p_plantilla    uuid default null      -- empresa de la que copiar el checklist
) returns jsonb
language plpgsql security definer
set search_path to 'public','app','pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid; v_slug text; v_nombre text;
  v_plantilla uuid; v_cats int := 0; v_items int := 0; v_criticos int := 0;
  v_estructura jsonb;
begin
  -- Crear empresas está por encima de administrar una: es del dueño del sistema.
  if not app.has_role('superadmin') then
    raise exception 'Sólo un superadministrador puede crear empresas';
  end if;

  v_nombre := btrim(coalesce(p_nombre, ''));
  if char_length(v_nombre) < 3 then
    raise exception 'El nombre de la empresa debe tener al menos 3 caracteres';
  end if;
  if char_length(v_nombre) > 80 then
    raise exception 'El nombre de la empresa no puede superar 80 caracteres';
  end if;
  if p_max_fallas < 1 or p_max_fallas > 20 then
    raise exception 'El límite de fallas no críticas debe estar entre 1 y 20';
  end if;

  -- Identificador legible y único, derivado del nombre.
  v_slug := regexp_replace(lower(translate(v_nombre,
              'áéíóúñüÁÉÍÓÚÑÜ', 'aeiounuAEIOUNU')), '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 5);
  end if;

  insert into public.organizations(name, slug, timezone, max_non_critical_bad, active)
    values (v_nombre, v_slug, coalesce(nullif(btrim(p_zona_horaria),''), 'America/Bogota'),
            p_max_fallas, true)
    returning id into v_org;

  -- Plantilla: la indicada, o la empresa activa de quien crea.
  v_plantilla := coalesce(p_plantilla, app.current_org());
  if v_plantilla is null or not exists (select 1 from public.organizations where id = v_plantilla) then
    raise exception 'No hay una empresa plantilla de la que copiar el checklist';
  end if;

  -- Copia del catálogo. Las categorías nuevas conservan su clave y orden; los
  -- ítems se recolocan bajo la categoría equivalente de la empresa nueva.
  insert into public.checklist_categories(organization_id, key, name, icon, sort_order, active)
  select v_org, c.key, c.name, c.icon, c.sort_order, c.active
  from public.checklist_categories c
  where c.organization_id = v_plantilla;
  get diagnostics v_cats = row_count;

  insert into public.checklist_items(
    organization_id, category_id, name, item_type, required, is_safety_critical, sort_order, active)
  select v_org, nueva.id, i.name, i.item_type, i.required, i.is_safety_critical, i.sort_order, i.active
  from public.checklist_items i
  join public.checklist_categories vieja on vieja.id = i.category_id
  join public.checklist_categories nueva
    on nueva.organization_id = v_org and nueva.key = vieja.key
  where i.organization_id = v_plantilla;
  get diagnostics v_items = row_count;

  select count(*) into v_criticos
  from public.checklist_items where organization_id = v_org and is_safety_critical;

  if v_items = 0 then
    raise exception 'La empresa plantilla no tiene checklist: no se puede crear una empresa sin él';
  end if;
  if v_criticos = 0 then
    raise exception 'El checklist copiado no tiene ningún ítem crítico de seguridad. '
                    'Se cancela: una empresa así autorizaría un vehículo sin frenos.';
  end if;

  -- Versión 1 publicada, con la misma forma que consume el kiosco.
  select jsonb_agg(cat order by cat->>'key') into v_estructura
  from (
    select jsonb_build_object(
             'key', c.key, 'name', c.name, 'icon', c.icon,
             'items', (
               select jsonb_agg(jsonb_build_object(
                        'id', i.id, 'name', i.name,
                        'item_type', i.item_type,
                        'is_safety_critical', i.is_safety_critical)
                      order by i.sort_order, i.name)
               from public.checklist_items i
               where i.category_id = c.id and i.active)) as cat
    from public.checklist_categories c
    where c.organization_id = v_org and c.active
    order by c.sort_order, c.name
  ) s;

  insert into public.checklist_versions(organization_id, version_number, structure, active, note, created_by)
    values (v_org, 1, coalesce(v_estructura, '[]'::jsonb), true,
            'Catálogo inicial copiado al crear la empresa', v_uid);

  -- Quien la crea queda dentro como administrador, para poder entrar a
  -- configurarla sin pasar otra vez por SQL.
  insert into public.organization_members(profile_id, organization_id, role)
    values (v_uid, v_org, 'admin')
    on conflict (profile_id, organization_id) do nothing;

  perform app.write_audit('organization_created','organization', v_org::text, null,
    jsonb_build_object('nombre', v_nombre, 'slug', v_slug,
                       'categorias', v_cats, 'items', v_items, 'criticos', v_criticos), null);

  return jsonb_build_object(
    'id', v_org, 'nombre', v_nombre, 'slug', v_slug,
    'categorias', v_cats, 'items', v_items, 'items_criticos', v_criticos);
end; $$;

revoke all on function public.create_organization(text, text, int, uuid) from public;
grant execute on function public.create_organization(text, text, int, uuid) to authenticated;

-- La lista de empresas sólo la ve el dueño del sistema.
drop policy if exists org_select_superadmin on public.organizations;
create policy org_select_superadmin on public.organizations
  for select to authenticated
  using (app.has_role('superadmin'));

-- ---------------------------------------------------------------------------
-- Correcciones que exige el cambio de empresa
-- ---------------------------------------------------------------------------

-- `prof_select` era `organization_id = app.current_org()`. Al cambiar de empresa
-- tu PROPIO perfil dejaba de ser visible (su organization_id es el de origen) y
-- el sistema te expulsaba al login. Ahora se ve siempre el propio, y además los
-- perfiles que pertenecen a la empresa activa aunque su origen sea otro.
drop policy if exists prof_select on public.profiles;
create policy prof_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or organization_id = app.current_org()
    or exists (select 1 from public.organization_members m
                where m.profile_id = profiles.id
                  and m.organization_id = app.current_org())
  );

-- El superadministrador es el dueño del SISTEMA, no de una empresa: su rol es
-- global y no depende de en cuál esté parado.
create or replace function app.has_role(variadic roles app.user_role[])
returns boolean
language sql stable security definer
set search_path to 'public','app','pg_temp'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (
        p.role = 'superadmin'
        or coalesce(
             (select m.role from public.organization_members m
               where m.profile_id = p.id and m.organization_id = app.current_org()),
             p.role
           ) = any(roles)
      )
  );
$$;

-- Contexto de sesión en una sola consulta: quién eres, en qué empresa estás
-- ahora (validada) y qué rol tienes EN ELLA.
create or replace function public.me()
returns table(
  id uuid, organization_id uuid, organization_name text,
  role app.user_role, full_name text, email text,
  active boolean, is_superadmin boolean, organizations_count int)
language sql stable security definer
set search_path to 'public','app','pg_temp'
as $$
  select
    p.id,
    app.current_org(),
    (select o.name from public.organizations o where o.id = app.current_org()),
    coalesce(
      (select m.role from public.organization_members m
        where m.profile_id = p.id and m.organization_id = app.current_org()),
      p.role),
    p.full_name, p.email, p.active,
    (p.role = 'superadmin'),
    (select count(*)::int from public.organization_members m where m.profile_id = p.id)
  from public.profiles p
  where p.id = auth.uid() and p.active;
$$;

revoke all on function public.me() from public;
grant execute on function public.me() to authenticated;
