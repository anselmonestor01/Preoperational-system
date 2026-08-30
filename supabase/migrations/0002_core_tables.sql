-- =============================================================================
-- MUNDO MARÍTIMO — Migración 0002: Tablas núcleo
-- -----------------------------------------------------------------------------
-- Modelo multi-tenant. organization_id en cada entidad de negocio.
-- Nunca se elimina físicamente algo con historial: soft-delete / archivado.
-- =============================================================================

-- 1) ORGANIZATIONS ------------------------------------------------------------
create table if not exists public.organizations (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  slug                  text not null unique,
  timezone              text not null default 'America/Bogota',
  -- Nº de fallas "Malo" NO críticas que, acumuladas, bloquean la salida.
  max_non_critical_bad  int  not null default 3 check (max_non_critical_bad between 1 and 50),
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 2) PROFILES (extiende auth.users) -------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  role             app.user_role not null default 'operator',
  full_name        text not null default '',
  email            text not null default '',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_profiles_org on public.profiles(organization_id);

-- 3) DRIVERS (conductores; se verifican por PIN en el kiosco) ------------------
create table if not exists public.drivers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  full_name        text not null,
  pin_hash         text,                       -- bcrypt; nunca el PIN en claro
  license          text default '',
  whatsapp         text default '',
  photo_path       text default '',            -- ruta en Storage (no base64)
  profile_id       uuid references public.profiles(id) on delete set null,
  active           boolean not null default true,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_drivers_org on public.drivers(organization_id);
create index if not exists idx_drivers_org_active on public.drivers(organization_id) where active;

-- 4) VEHICLES -----------------------------------------------------------------
create table if not exists public.vehicles (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete restrict,
  plate              text not null,
  reference          text default 'Camión de carga',
  model              text default '',
  operation_card     text default '',          -- tarjeta de operación
  insurance_expires  date,
  emissions_expires  date,
  oil_change_date    date,
  status             app.vehicle_status not null default 'active',
  admin_blocked      boolean not null default false,
  admin_block_reason text default '',
  blocked_at         timestamptz,
  blocked_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- La placa es única por organización sólo entre vehículos NO archivados.
  constraint uq_vehicle_plate_org unique (organization_id, plate)
);
create index if not exists idx_vehicles_org on public.vehicles(organization_id);
create index if not exists idx_vehicles_org_status on public.vehicles(organization_id, status);

-- 5) CHECKLIST_CATEGORIES (estructura editable actual) ------------------------
create table if not exists public.checklist_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  key              text not null,
  name             text not null,
  icon             text default 'kit',
  sort_order       int  not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint uq_cat_key_org unique (organization_id, key)
);
create index if not exists idx_cat_org on public.checklist_categories(organization_id);

-- 6) CHECKLIST_ITEMS ----------------------------------------------------------
create table if not exists public.checklist_items (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete restrict,
  category_id        uuid not null references public.checklist_categories(id) on delete cascade,
  name               text not null,
  item_type          app.item_type not null default 'estado',
  required           boolean not null default true,
  -- Criticidad EXPLÍCITA (reemplaza el matching por texto del prototipo):
  -- un ítem crítico en severidad 'bad' bloquea la autorización de salida.
  is_safety_critical boolean not null default false,
  sort_order         int not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_items_org on public.checklist_items(organization_id);
create index if not exists idx_items_cat on public.checklist_items(category_id);

-- 7) CHECKLIST_VERSIONS (snapshot inmutable por versión) ----------------------
create table if not exists public.checklist_versions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  version_number   int not null,
  -- Estructura congelada: [{key,name,icon,items:[{id,name,item_type,is_safety_critical,required}]}]
  structure        jsonb not null,
  active           boolean not null default true,
  note             text default '',
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint uq_version_org unique (organization_id, version_number)
);
-- Sólo una versión activa por organización.
create unique index if not exists uq_active_version_org
  on public.checklist_versions(organization_id) where active;

-- 8) ROUNDS -------------------------------------------------------------------
create table if not exists public.rounds (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  round_number     int not null,
  label            text not null,
  status           app.round_status not null default 'open',
  started_at       timestamptz not null default now(),
  started_by       uuid references public.profiles(id) on delete set null,
  closed_at        timestamptz,
  closed_by        uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint uq_round_number_org unique (organization_id, round_number)
);
-- Sólo una ronda ABIERTA por organización (evita dos admins abriendo a la vez).
create unique index if not exists uq_open_round_org
  on public.rounds(organization_id) where status = 'open';

-- 9) INSPECTIONS (incluye la operación embebida: km/combustible/recorrido) -----
create table if not exists public.inspections (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  round_id              uuid not null references public.rounds(id) on delete restrict,
  vehicle_id            uuid not null references public.vehicles(id) on delete restrict,
  driver_id             uuid references public.drivers(id) on delete set null,
  checklist_version_id  uuid references public.checklist_versions(id) on delete set null,
  -- Congelado en el momento del envío (integridad histórica):
  vehicle_plate         text,
  driver_name           text,
  checklist_version_number int,
  checklist_snapshot    jsonb,
  answers               jsonb not null default '[]'::jsonb,  -- borrador / respuestas

  status                app.inspection_status not null default 'in_progress',
  result                app.inspection_result,
  authorized            boolean,
  auth_reasons          jsonb not null default '[]'::jsonb,

  km_inicial            int check (km_inicial is null or km_inicial >= 0),
  km_final              int check (km_final is null or km_final >= 0),
  fuel_in               text,
  fuel_out              text,
  recorrido             int generated always as
                          (case when km_final is not null and km_inicial is not null
                                then km_final - km_inicial else null end) stored,
  obs_general           text default '',

  ok_count              int not null default 0,
  warn_count            int not null default 0,
  bad_count             int not null default 0,
  total_items           int not null default 0,

  operation_status      app.operation_status not null default 'none',
  released              boolean not null default false,  -- liberada para re-inspección
  void_reason           text,
  voided_by             uuid references public.profiles(id) on delete set null,

  idempotency_key       text,
  created_by            uuid references public.profiles(id) on delete set null,
  submitted_at          timestamptz,
  authorized_at         timestamptz,
  closed_at             timestamptz,
  voided_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_insp_org        on public.inspections(organization_id);
create index if not exists idx_insp_org_created on public.inspections(organization_id, created_at desc);
create index if not exists idx_insp_vehicle     on public.inspections(vehicle_id);
create index if not exists idx_insp_round       on public.inspections(round_id);
create index if not exists idx_insp_status      on public.inspections(organization_id, status);
create index if not exists idx_insp_open_ops    on public.inspections(organization_id)
  where operation_status = 'open';

-- Idempotencia real: no dos envíos con la misma clave por organización.
create unique index if not exists uq_insp_idempotency
  on public.inspections(organization_id, idempotency_key)
  where idempotency_key is not null;

-- Una sola inspección VÁLIDA por vehículo por ronda (anti doble inspección).
create unique index if not exists uq_insp_vehicle_round_active
  on public.inspections(vehicle_id, round_id)
  where status in ('submitted','authorized','rejected','closed') and released = false;

-- Un solo BORRADOR por vehículo por ronda.
create unique index if not exists uq_insp_vehicle_round_draft
  on public.inspections(vehicle_id, round_id)
  where status = 'in_progress';

-- 10) INSPECTION_ANSWERS (materializadas al enviar, para reportes/consultas) ---
create table if not exists public.inspection_answers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  inspection_id    uuid not null references public.inspections(id) on delete cascade,
  category_key     text,
  item_id          uuid,
  item_name        text not null,
  item_type        app.item_type not null,
  value            text not null,
  severity         app.answer_severity not null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_ans_insp on public.inspection_answers(inspection_id);
create index if not exists idx_ans_org  on public.inspection_answers(organization_id);

-- 11) ISSUES (novedades) ------------------------------------------------------
create table if not exists public.issues (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  inspection_id    uuid references public.inspections(id) on delete set null,
  vehicle_id       uuid not null references public.vehicles(id) on delete restrict,
  driver_id        uuid references public.drivers(id) on delete set null,
  round_id         uuid references public.rounds(id) on delete set null,
  category_key     text,
  item_name        text not null,
  severity         app.answer_severity not null default 'bad',
  description      text default '',
  due_date         date,
  status           app.issue_status not null default 'pending',
  assigned_to      uuid references public.profiles(id) on delete set null,
  resolution_note  text default '',
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles(id) on delete set null,
  reopened_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_issues_org on public.issues(organization_id);
create index if not exists idx_issues_vehicle on public.issues(vehicle_id);
create index if not exists idx_issues_open on public.issues(organization_id, vehicle_id)
  where status <> 'resolved';

-- 12) ISSUE_EVIDENCE (fotos en Storage) ---------------------------------------
create table if not exists public.issue_evidence (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  issue_id         uuid references public.issues(id) on delete cascade,
  inspection_id    uuid references public.inspections(id) on delete set null,
  storage_path     text not null,
  mime             text default 'image/jpeg',
  size_bytes       int,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_evidence_issue on public.issue_evidence(issue_id);
create index if not exists idx_evidence_org on public.issue_evidence(organization_id);

-- 13) AUDIT_LOGS (append-only) ------------------------------------------------
create table if not exists public.audit_logs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid references public.organizations(id) on delete set null,
  actor_profile_id  uuid references public.profiles(id) on delete set null,
  actor_label       text,
  action            text not null,
  entity_type       text,
  entity_id         text,
  old_value         jsonb,
  new_value         jsonb,
  context           jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists idx_audit_org on public.audit_logs(organization_id, created_at desc);
create index if not exists idx_audit_entity on public.audit_logs(entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- Triggers updated_at
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','drivers','vehicles','checklist_categories',
    'checklist_items','inspections','issues'
  ] loop
    execute format(
      'drop trigger if exists trg_touch_%1$s on public.%1$s;
       create trigger trg_touch_%1$s before update on public.%1$s
       for each row execute function app.touch_updated_at();', t);
  end loop;
end $$;
