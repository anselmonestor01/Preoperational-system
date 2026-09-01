-- 0017 — Regreso limpio libera el vehículo, y cola de avisos de WhatsApp
-- =============================================================================
-- 1) Al registrar el regreso SIN novedades, el vehículo queda libre otra vez.
-- 2) Cola de notificaciones (recordatorio de registrar el regreso).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Cola de notificaciones — patrón "bandeja de salida".
--
-- La notificación NO se envía desde la función de negocio: se ENCOLA. Si el
-- proveedor de mensajería está caído, una inspección jamás debe fallar por eso.
-- Un proceso aparte lee esta cola y envía; si falla, reintenta.
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  canal           text not null default 'whatsapp',
  destinatario    text not null,
  mensaje         text not null,
  inspection_id   uuid references public.inspections(id) on delete cascade,
  driver_id       uuid references public.drivers(id) on delete set null,
  estado          text not null default 'pendiente',
  intentos        int  not null default 0,
  ultimo_error    text,
  enviado_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint chk_notif_estado check (estado in ('pendiente','enviado','fallido','sin_destino')),
  constraint chk_notif_mensaje check (char_length(mensaje) between 1 and 1000)
);

create index if not exists idx_notifications_pendientes
  on public.notifications(created_at) where estado = 'pendiente';

alter table public.notifications enable row level security;

drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications
  for select to authenticated
  using (organization_id = app.current_org() and app.has_role('admin','supervisor','superadmin'));

comment on table public.notifications is
  'Bandeja de salida de avisos. Se encolan aquí para que un fallo del proveedor '
  'de mensajería nunca haga fallar una inspección.';

-- ---------------------------------------------------------------------------
-- Encolar el recordatorio de regreso cuando una inspección queda AUTORIZADA.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_return_reminder(p_inspection_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare
  v_org uuid; v_insp public.inspections; v_tel text; v_nombre text; v_msg text;
begin
  v_org := app.current_org();
  if v_org is null then raise exception 'No autorizado'; end if;

  select * into v_insp from public.inspections
    where id = p_inspection_id and organization_id = v_org;
  if not found then raise exception 'Inspección no encontrada'; end if;

  -- Sólo tiene sentido recordar el regreso de una salida autorizada y abierta.
  if v_insp.authorized is not true or v_insp.operation_status <> 'open' then
    return jsonb_build_object('ok', false, 'motivo', 'no_aplica');
  end if;

  select whatsapp, full_name into v_tel, v_nombre
    from public.drivers where id = v_insp.driver_id;

  v_msg := format(
    '🤗 ¡Buen viaje, %s! Registraste la salida de %s a las %s. '
    'No olvides registrar tu REGRESO al volver: sin ese registro el vehículo '
    'sigue figurando en ruta y no queda disponible para el siguiente turno. '
    '¡Gracias por cuidar la flota!',
    coalesce(split_part(btrim(v_nombre), ' ', 1), 'conductor'),
    coalesce(v_insp.vehicle_plate, 'tu vehículo'),
    to_char(timezone('America/Bogota', coalesce(v_insp.submitted_at, now())), 'HH12:MI AM'));

  insert into public.notifications(
    organization_id, canal, destinatario, mensaje, inspection_id, driver_id, estado)
  values (
    v_org, 'whatsapp',
    coalesce(nullif(btrim(v_tel), ''), ''),
    v_msg, p_inspection_id, v_insp.driver_id,
    case when coalesce(btrim(v_tel), '') = '' then 'sin_destino' else 'pendiente' end);

  return jsonb_build_object('ok', true, 'con_destino', coalesce(btrim(v_tel),'') <> '');
end; $$;

-- ---------------------------------------------------------------------------
-- register_return: cierra la operación y, si el vehículo NO quedó con
-- novedades, lo libera para que pueda volver a operar de inmediato.
-- ---------------------------------------------------------------------------
create or replace function public.register_return(
  p_inspection_id uuid, p_km_final int, p_fuel_out text)
returns jsonb language plpgsql security definer
set search_path = public, app, pg_temp as $$
declare v_org uuid; v_insp public.inspections; v_abiertas int; v_liberado boolean := false;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('operator','driver','supervisor','admin','superadmin')
    then raise exception 'No autorizado'; end if;

  select * into v_insp from public.inspections
    where id=p_inspection_id and organization_id=v_org for update;
  if not found then raise exception 'Inspección no encontrada'; end if;
  if v_insp.operation_status <> 'open' then raise exception 'La operación no está abierta'; end if;

  if v_insp.km_inicial is not null and p_km_final is not null and p_km_final < v_insp.km_inicial then
    raise exception 'El kilometraje final no puede ser menor al inicial';
  end if;

  update public.inspections set km_final=p_km_final, fuel_out=p_fuel_out,
    operation_status='closed', status='closed', closed_at=now()
  where id=p_inspection_id;

  -- ¿Volvió limpio? Si no dejó novedades sin resolver, el vehículo se libera y
  -- vuelve a estar disponible en la misma ronda: cumplió su ciclo completo.
  select count(*) into v_abiertas from public.issues
    where vehicle_id = v_insp.vehicle_id and status <> 'resolved';

  if v_abiertas = 0 then
    update public.inspections set released = true where id = p_inspection_id;
    v_liberado := true;
  end if;

  -- El conductor deja de tener el perfil reservado.
  delete from public.driver_claims where driver_id = v_insp.driver_id;

  perform app.write_audit('operation_closed','inspection',p_inspection_id::text,
    jsonb_build_object('km_inicial',v_insp.km_inicial),
    jsonb_build_object('km_final',p_km_final,'fuel_out',p_fuel_out,'liberado',v_liberado), null);

  return jsonb_build_object('id',p_inspection_id,'status','closed',
    'recorrido', p_km_final - coalesce(v_insp.km_inicial,0),
    'vehiculo_liberado', v_liberado,
    'novedades_pendientes', v_abiertas);
end; $$;

revoke execute on function public.enqueue_return_reminder(uuid) from public, anon;
grant execute on function public.enqueue_return_reminder(uuid) to authenticated;
