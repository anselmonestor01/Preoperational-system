-- 0022 — Consola de plataforma: vigilar las empresas SIN ver sus datos.
--
-- LA REGLA QUE NO SE NEGOCIA
-- El dueño del sistema necesita saber cuántas inspecciones hace cada empresa
-- para facturar, para detectar a un cliente que dejó de usarlo y para soportarlo
-- cuando llama. No necesita —ni debe— ver los nombres de sus conductores, sus
-- placas ni las fotos de sus novedades: esos datos son de la empresa, y en
-- Colombia la Ley 1581 de habeas data los protege.
--
-- Por eso esta función devuelve ÚNICAMENTE conteos, fechas y el nombre de la
-- empresa. Ni una sola fila de contenido. El superadministrador puede CONTAR lo
-- que hay en otra empresa; no puede LEERLO: las 25 políticas RLS siguen intactas
-- y él sigue sin poder consultar esas tablas directamente.

-- Datos comerciales de cada empresa, para que la consola sirva para cobrar.
alter table public.organizations
  add column if not exists plan text not null default 'demo',
  add column if not exists billing_status text not null default 'al_dia',
  add column if not exists billing_note text;

alter table public.organizations drop constraint if exists chk_org_billing_status;
alter table public.organizations add constraint chk_org_billing_status
  check (billing_status in ('al_dia','pendiente','suspendido'));

alter table public.organizations drop constraint if exists chk_org_plan;
alter table public.organizations add constraint chk_org_plan
  check (plan in ('demo','basico','profesional','grupo'));

comment on column public.organizations.plan is
  'Plan comercial. Sólo lo ve y lo cambia el superadministrador desde la consola.';

-- ---------------------------------------------------------------------------
-- Panorama de todas las empresas. Sólo números.
-- ---------------------------------------------------------------------------
create or replace function public.platform_overview()
returns table(
  organization_id       uuid,
  nombre                text,
  plan                  text,
  billing_status        text,
  billing_note          text,
  creada                timestamptz,
  vehiculos             int,
  conductores           int,
  usuarios              int,
  inspecciones_7d       int,
  inspecciones_30d      int,
  inspecciones_total    int,
  ultima_actividad      timestamptz,
  vehiculos_bloqueados  int,
  novedades_pendientes  int,
  avisos_en_cola        int,
  evidencias            int,
  ronda_abierta         boolean
)
language plpgsql stable security definer
set search_path to 'public','app','pg_temp'
as $$
begin
  if not app.has_role('superadmin') then
    raise exception 'Sólo el superadministrador puede ver el panorama de la plataforma';
  end if;

  return query
  select
    o.id,
    o.name,
    o.plan,
    o.billing_status,
    o.billing_note,
    o.created_at,
    (select count(*)::int from public.vehicles v
       where v.organization_id = o.id and v.status <> 'archived'),
    (select count(*)::int from public.drivers d
       where d.organization_id = o.id and d.active),
    (select count(*)::int from public.organization_members m
       where m.organization_id = o.id),
    (select count(*)::int from public.inspections i
       where i.organization_id = o.id and i.submitted_at > now() - interval '7 days'),
    (select count(*)::int from public.inspections i
       where i.organization_id = o.id and i.submitted_at > now() - interval '30 days'),
    (select count(*)::int from public.inspections i
       where i.organization_id = o.id),
    (select max(i.submitted_at) from public.inspections i
       where i.organization_id = o.id),
    (select count(*)::int from public.vehicles v
       where v.organization_id = o.id and v.admin_blocked),
    (select count(*)::int from public.issues s
       where s.organization_id = o.id and s.status <> 'resolved'),
    (select count(*)::int from public.notifications n
       where n.organization_id = o.id and n.estado in ('pendiente','fallido')),
    (select count(*)::int from public.issue_evidence e
       where e.organization_id = o.id),
    exists (select 1 from public.rounds r
              where r.organization_id = o.id and r.status = 'open')
  from public.organizations o
  order by o.name;
end; $$;

revoke all on function public.platform_overview() from public;
grant execute on function public.platform_overview() to authenticated;

comment on function public.platform_overview() is
  'Panorama de todas las empresas para el dueño del sistema. Devuelve SÓLO '
  'conteos y fechas: ninguna placa, ningún nombre de conductor, ninguna foto.';

-- ---------------------------------------------------------------------------
-- Estado comercial de una empresa
-- ---------------------------------------------------------------------------
create or replace function public.set_organization_billing(
  p_org_id uuid, p_plan text, p_status text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path to 'public','app','pg_temp'
as $$
declare v_antes jsonb;
begin
  if not app.has_role('superadmin') then
    raise exception 'Sólo el superadministrador puede cambiar el plan de una empresa';
  end if;

  select jsonb_build_object('plan', plan, 'billing_status', billing_status)
    into v_antes from public.organizations where id = p_org_id;
  if v_antes is null then raise exception 'Empresa no encontrada'; end if;

  update public.organizations
     set plan = p_plan,
         billing_status = p_status,
         billing_note = left(nullif(btrim(coalesce(p_note,'')), ''), 300),
         updated_at = now()
   where id = p_org_id;

  perform app.write_audit('organization_billing_changed','organization', p_org_id::text,
    v_antes, jsonb_build_object('plan', p_plan, 'billing_status', p_status), null);

  return jsonb_build_object('ok', true);
end; $$;

revoke all on function public.set_organization_billing(uuid, text, text, text) from public;
grant execute on function public.set_organization_billing(uuid, text, text, text) to authenticated;
