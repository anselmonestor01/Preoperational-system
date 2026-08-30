-- =============================================================================
-- MUNDO MARÍTIMO — Migración 0003: Row Level Security + políticas
-- -----------------------------------------------------------------------------
-- Regla de oro: NUNCA se confía en el organization_id enviado por el cliente.
-- Todo SELECT se limita a app.current_org() y a perfiles ACTIVOS. Las
-- transiciones críticas se hacen por RPC SECURITY DEFINER (migración 0004);
-- aquí sólo se abren los caminos de lectura y el CRUD administrativo simple.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones de contexto de sesión (SECURITY DEFINER: no recursan sobre RLS).
-- Se definen aquí porque referencian public.profiles (ya creada en 0002).
-- -----------------------------------------------------------------------------
create or replace function app.current_org()
returns uuid language sql stable security definer
set search_path = public, app, pg_temp as $$
  select organization_id from public.profiles
  where id = auth.uid() and active = true limit 1;
$$;

create or replace function app.current_role()
returns app.user_role language sql stable security definer
set search_path = public, app, pg_temp as $$
  select role from public.profiles where id = auth.uid() and active = true limit 1;
$$;

create or replace function app.is_active()
returns boolean language sql stable security definer
set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active = true);
$$;

create or replace function app.has_role(variadic roles app.user_role[])
returns boolean language sql stable security definer
set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.profiles
    where id = auth.uid() and active = true and role = any(roles));
$$;

grant execute on function
  app.current_org(), app.current_role(), app.is_active(), app.has_role(app.user_role[])
to authenticated;

-- Privilegios base (RLS sigue gobernando fila a fila).
grant select on
  public.organizations, public.profiles, public.drivers, public.vehicles,
  public.checklist_categories, public.checklist_items, public.checklist_versions,
  public.rounds, public.inspections, public.inspection_answers,
  public.issues, public.issue_evidence, public.audit_logs
to authenticated;

grant insert, update on
  public.organizations, public.profiles, public.drivers, public.vehicles,
  public.checklist_categories, public.checklist_items
to authenticated;

grant insert on public.issue_evidence to authenticated;

-- El hash del PIN JAMÁS es legible por clientes (sólo por RPC definer).
revoke select on public.drivers from authenticated;
grant select (
  id, organization_id, full_name, license, whatsapp, photo_path,
  profile_id, active, created_by, created_at, updated_at
) on public.drivers to authenticated;
grant update (
  full_name, license, whatsapp, photo_path, active, updated_at
) on public.drivers to authenticated;

-- Activar RLS en todas las tablas de negocio.
alter table public.organizations       enable row level security;
alter table public.profiles            enable row level security;
alter table public.drivers             enable row level security;
alter table public.vehicles            enable row level security;
alter table public.checklist_categories enable row level security;
alter table public.checklist_items     enable row level security;
alter table public.checklist_versions  enable row level security;
alter table public.rounds              enable row level security;
alter table public.inspections         enable row level security;
alter table public.inspection_answers  enable row level security;
alter table public.issues              enable row level security;
alter table public.issue_evidence      enable row level security;
alter table public.audit_logs          enable row level security;

-- ORGANIZATIONS ---------------------------------------------------------------
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select to authenticated
  using (id = app.current_org());
drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations for update to authenticated
  using (id = app.current_org() and app.has_role('admin','superadmin'))
  with check (id = app.current_org());

-- PROFILES --------------------------------------------------------------------
drop policy if exists prof_select on public.profiles;
create policy prof_select on public.profiles for select to authenticated
  using (organization_id = app.current_org());
drop policy if exists prof_insert on public.profiles;
create policy prof_insert on public.profiles for insert to authenticated
  with check (organization_id = app.current_org() and app.has_role('admin','superadmin'));
drop policy if exists prof_update on public.profiles;
create policy prof_update on public.profiles for update to authenticated
  using (organization_id = app.current_org() and app.has_role('admin','superadmin'))
  with check (organization_id = app.current_org());

-- DRIVERS ---------------------------------------------------------------------
drop policy if exists drv_select on public.drivers;
create policy drv_select on public.drivers for select to authenticated
  using (organization_id = app.current_org());
drop policy if exists drv_insert on public.drivers;
create policy drv_insert on public.drivers for insert to authenticated
  with check (organization_id = app.current_org()
              and app.has_role('admin','supervisor','superadmin'));
drop policy if exists drv_update on public.drivers;
create policy drv_update on public.drivers for update to authenticated
  using (organization_id = app.current_org()
         and app.has_role('admin','supervisor','superadmin'))
  with check (organization_id = app.current_org());

-- VEHICLES --------------------------------------------------------------------
drop policy if exists veh_select on public.vehicles;
create policy veh_select on public.vehicles for select to authenticated
  using (organization_id = app.current_org());
drop policy if exists veh_insert on public.vehicles;
create policy veh_insert on public.vehicles for insert to authenticated
  with check (organization_id = app.current_org()
              and app.has_role('admin','supervisor','superadmin'));
drop policy if exists veh_update on public.vehicles;
create policy veh_update on public.vehicles for update to authenticated
  using (organization_id = app.current_org()
         and app.has_role('admin','supervisor','superadmin'))
  with check (organization_id = app.current_org());

-- CHECKLIST_CATEGORIES --------------------------------------------------------
drop policy if exists cat_select on public.checklist_categories;
create policy cat_select on public.checklist_categories for select to authenticated
  using (organization_id = app.current_org());
drop policy if exists cat_write on public.checklist_categories;
create policy cat_write on public.checklist_categories for all to authenticated
  using (organization_id = app.current_org() and app.has_role('admin','superadmin'))
  with check (organization_id = app.current_org() and app.has_role('admin','superadmin'));

-- CHECKLIST_ITEMS -------------------------------------------------------------
drop policy if exists item_select on public.checklist_items;
create policy item_select on public.checklist_items for select to authenticated
  using (organization_id = app.current_org());
drop policy if exists item_write on public.checklist_items;
create policy item_write on public.checklist_items for all to authenticated
  using (organization_id = app.current_org() and app.has_role('admin','superadmin'))
  with check (organization_id = app.current_org() and app.has_role('admin','superadmin'));

-- CHECKLIST_VERSIONS (sólo lectura directa; se publica por RPC) ----------------
drop policy if exists ver_select on public.checklist_versions;
create policy ver_select on public.checklist_versions for select to authenticated
  using (organization_id = app.current_org());

-- ROUNDS (sólo lectura directa; se abre/cierra por RPC) ------------------------
drop policy if exists round_select on public.rounds;
create policy round_select on public.rounds for select to authenticated
  using (organization_id = app.current_org());

-- INSPECTIONS (sólo lectura directa; todo cambio por RPC) ----------------------
drop policy if exists insp_select on public.inspections;
create policy insp_select on public.inspections for select to authenticated
  using (organization_id = app.current_org());

-- INSPECTION_ANSWERS (sólo lectura directa) -----------------------------------
drop policy if exists ans_select on public.inspection_answers;
create policy ans_select on public.inspection_answers for select to authenticated
  using (organization_id = app.current_org());

-- ISSUES (sólo lectura directa; lifecycle por RPC) ----------------------------
drop policy if exists issue_select on public.issues;
create policy issue_select on public.issues for select to authenticated
  using (organization_id = app.current_org());

-- ISSUE_EVIDENCE --------------------------------------------------------------
drop policy if exists evi_select on public.issue_evidence;
create policy evi_select on public.issue_evidence for select to authenticated
  using (organization_id = app.current_org());
drop policy if exists evi_insert on public.issue_evidence;
create policy evi_insert on public.issue_evidence for insert to authenticated
  with check (organization_id = app.current_org());

-- AUDIT_LOGS (lectura sólo admin/auditor; escritura sólo por RPC definer) ------
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using (organization_id = app.current_org()
         and app.has_role('admin','auditor','superadmin'));
-- Sin políticas de insert/update/delete: append-only vía funciones definer.
