-- =============================================================================
-- MUNDO MARÍTIMO — Migración 0007 (FASE 2)
-- Estado de vehículo como FUENTE ÚNICA DE VERDAD + personalización de rondas.
-- =============================================================================

-- Rondas: campos de personalización.
alter table public.rounds add column if not exists responsible text default '';
alter table public.rounds add column if not exists notes text default '';

-- start_round con personalización (reemplaza la firma anterior de 1 argumento).
drop function if exists public.start_round(text);
create or replace function public.start_round(p_label text, p_responsible text, p_notes text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare v_org uuid; v_num int; v_id uuid; v_label text;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then raise exception 'No autorizado'; end if;
  perform pg_advisory_xact_lock(hashtext('round:'||v_org::text));
  update public.rounds set status='closed', closed_at=now(), closed_by=auth.uid()
    where organization_id=v_org and status='open';
  select coalesce(max(round_number),0)+1 into v_num from public.rounds where organization_id=v_org;
  v_label := coalesce(nullif(trim(p_label),''), 'Ronda '||v_num);
  insert into public.rounds(organization_id, round_number, label, status, started_by, responsible, notes)
    values (v_org, v_num, v_label, 'open', auth.uid(), coalesce(p_responsible,''), coalesce(p_notes,''))
    returning id into v_id;
  perform app.write_audit('round_started','round',v_id::text,null,
    jsonb_build_object('round_number',v_num,'label',v_label,'responsible',p_responsible),null);
  return jsonb_build_object('id',v_id,'round_number',v_num,'label',v_label);
end; $$;
revoke execute on function public.start_round(text,text,text) from public, anon;
grant execute on function public.start_round(text,text,text) to authenticated;

-- -----------------------------------------------------------------------------
-- VISTA de estado de vehículo — usada por ADMIN y KIOSCO (misma verdad).
-- security_invoker => respeta la RLS del usuario que consulta.
-- availability (precedencia):
--   archived > out_of_service > admin_blocked > issues > inspected > available
-- -----------------------------------------------------------------------------
create or replace view public.vehicle_status_view
with (security_invoker = true) as
select
  v.id, v.organization_id, v.plate, v.reference, v.model, v.operation_card,
  v.insurance_expires, v.emissions_expires, v.oil_change_date,
  v.status, v.admin_blocked, v.admin_block_reason, v.blocked_at,
  v.created_at, v.updated_at,
  coalesce(oi.cnt,0) as open_issue_count,
  (coalesce(oi.cnt,0) > 0) as has_open_issues,
  (ci.insp_id is not null) as inspected_in_round,
  ci.insp_id as current_round_inspection_id,
  ci.drv as current_round_driver,
  case
    when v.status = 'archived' then 'archived'
    when v.status <> 'active' then 'out_of_service'
    when v.admin_blocked then 'admin_blocked'
    when coalesce(oi.cnt,0) > 0 then 'issues'
    when ci.insp_id is not null then 'inspected'
    else 'available'
  end as availability
from public.vehicles v
left join lateral (
  select count(*) cnt from public.issues i
  where i.vehicle_id = v.id and i.status <> 'resolved'
) oi on true
left join lateral (
  select i.id insp_id, i.driver_name drv
  from public.inspections i
  join public.rounds r on r.id = i.round_id
  where i.vehicle_id = v.id
    and r.organization_id = v.organization_id and r.status = 'open'
    and i.status in ('submitted','authorized','rejected','closed')
    and i.released = false
  order by i.created_at desc limit 1
) ci on true;

grant select on public.vehicle_status_view to authenticated;
