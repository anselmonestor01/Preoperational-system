-- 0018 — Avisos operativos, dispositivo visible y borrado de rondas correcto.
--
-- Resuelve cuatro fallos reales detectados en producción:
--
-- 1. La tabla `notifications` no tenía política de UPDATE, así que el botón
--    "Marcar como enviado" del panel de Avisos actualizaba CERO filas sin
--    devolver ningún error. El panel parecía roto porque lo estaba.
-- 2. `delete_round` no borraba las novedades colgadas de la ronda por
--    `issues.round_id` (las que quedaron sin inspección tras un borrado
--    anterior), de modo que sobrevivían y ensuciaban el historial.
-- 3. La inspección guardaba el identificador del dispositivo pero no su
--    descripción, así que en el panel no había forma de saber desde qué equipo
--    se registró.
-- 4. El número de WhatsApp se copiaba al aviso al crearlo. Si el conductor no
--    lo tenía registrado, el aviso quedaba "sin destino" para siempre aunque
--    después se corrigiera el número.

-- ---------------------------------------------------------------------------
-- 1. Descripción del dispositivo en la inspección
-- ---------------------------------------------------------------------------

alter table public.inspections
  add column if not exists device_label text;

comment on column public.inspections.device_label is
  'Descripción legible del equipo que registró la inspección (ej. "Android - Chrome"). '
  'Es trazabilidad operativa, NO una credencial: la declara el navegador, así que '
  'nunca debe usarse para tomar decisiones de seguridad.';

alter table public.inspections drop constraint if exists inspections_device_label_len;
alter table public.inspections add constraint inspections_device_label_len
  check (device_label is null or char_length(device_label) <= 120);

-- Se reemplaza la versión de dos argumentos: ahora el kiosco envía también la
-- descripción del equipo. Los nombres de parámetro no cambian, así que las
-- llamadas existentes siguen siendo válidas.
drop function if exists public.bind_inspection_device(uuid, text);

create or replace function public.bind_inspection_device(
  p_inspection_id uuid,
  p_device_id text,
  p_device_label text default null
) returns jsonb
language plpgsql security definer
set search_path to 'public','app','pg_temp'
as $$
declare v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null then raise exception 'No autorizado'; end if;

  -- Sólo se marca la primera vez: el equipo que registró la salida queda
  -- fijado y no puede reescribirse desde otro dispositivo.
  update public.inspections
    set device_id    = nullif(btrim(p_device_id), ''),
        device_label = left(nullif(btrim(p_device_label), ''), 120)
    where id = p_inspection_id
      and organization_id = v_org
      and device_id is null;

  return jsonb_build_object('ok', found);
end; $$;

revoke all on function public.bind_inspection_device(uuid, text, text) from public;
grant execute on function public.bind_inspection_device(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Avisos: tipo, autor e índices
-- ---------------------------------------------------------------------------

alter table public.notifications
  add column if not exists tipo text not null default 'regreso',
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.notifications drop constraint if exists notifications_tipo_chk;
alter table public.notifications add constraint notifications_tipo_chk
  check (tipo in ('regreso','personalizado'));

comment on column public.notifications.tipo is
  '"regreso": lo genera el sistema al autorizar una salida. "personalizado": lo escribe un administrador.';

create index if not exists idx_notifications_driver on public.notifications(driver_id);
create index if not exists idx_notifications_created_by on public.notifications(created_by);
create index if not exists idx_notifications_org_estado
  on public.notifications(organization_id, estado, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Marcar un aviso como enviado
-- ---------------------------------------------------------------------------
-- Antes se intentaba con un UPDATE directo desde el navegador, pero la tabla
-- sólo tenía política de SELECT: la operación no fallaba, simplemente no hacía
-- nada. Se resuelve con un RPC, coherente con el resto del sistema (toda
-- escritura pasa por una función controlada).

create or replace function public.mark_notification_sent(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public','app','pg_temp'
as $$
declare v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then
    raise exception 'No autorizado';
  end if;

  update public.notifications
    set estado = 'enviado', enviado_at = now()
    where id = p_id and organization_id = v_org and estado <> 'enviado';

  if not found then raise exception 'El aviso no existe o ya estaba enviado'; end if;
  return jsonb_build_object('ok', true);
end; $$;

revoke all on function public.mark_notification_sent(uuid) from public;
grant execute on function public.mark_notification_sent(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Descartar un aviso que ya no aplica
-- ---------------------------------------------------------------------------

create or replace function public.discard_notification(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public','app','pg_temp'
as $$
declare v_org uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then
    raise exception 'No autorizado';
  end if;

  delete from public.notifications
    where id = p_id and organization_id = v_org and estado <> 'enviado';

  if not found then raise exception 'El aviso no existe o ya fue enviado'; end if;
  return jsonb_build_object('ok', true);
end; $$;

revoke all on function public.discard_notification(uuid) from public;
grant execute on function public.discard_notification(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Mensaje personalizado a un conductor
-- ---------------------------------------------------------------------------
-- El administrador escribe el texto y el sistema lo deja en la misma cola que
-- los recordatorios automáticos. Así queda registrado quién escribió qué y
-- cuándo, y sale por la misma vía (enlace de WhatsApp o API de empresa).

create or replace function public.send_custom_message(
  p_driver_id uuid,
  p_mensaje text
) returns jsonb
language plpgsql security definer
set search_path to 'public','app','pg_temp'
as $$
declare
  v_org uuid; v_tel text; v_nombre text; v_msg text; v_id uuid;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then
    raise exception 'No autorizado';
  end if;

  -- Se conservan los caracteres imprimibles y los espacios (incluido el salto
  -- de línea) y se descarta cualquier otro carácter de control, para que el
  -- texto guardado sea exactamente el que se ve.
  v_msg := btrim(regexp_replace(coalesce(p_mensaje, ''), '[^[:print:][:space:]]', '', 'g'));

  if char_length(v_msg) < 5 then
    raise exception 'El mensaje debe tener al menos 5 caracteres';
  end if;
  if char_length(v_msg) > 900 then
    raise exception 'El mensaje no puede superar 900 caracteres';
  end if;

  select nullif(btrim(whatsapp), ''), full_name into v_tel, v_nombre
    from public.drivers
    where id = p_driver_id and organization_id = v_org and active;
  if not found then raise exception 'Conductor no encontrado'; end if;

  insert into public.notifications(
    organization_id, canal, destinatario, mensaje, driver_id, estado, tipo, created_by)
  values (
    v_org, 'whatsapp', coalesce(v_tel, ''), v_msg, p_driver_id,
    case when v_tel is null then 'sin_destino' else 'pendiente' end,
    'personalizado', auth.uid())
  returning id into v_id;

  perform app.write_audit('message_queued','driver',p_driver_id::text,
    null,
    jsonb_build_object('destinatario', coalesce(v_tel,''), 'largo', char_length(v_msg)),
    null);

  return jsonb_build_object(
    'id', v_id,
    'destinatario', coalesce(v_tel, ''),
    'nombre', v_nombre,
    'mensaje', v_msg,
    'con_destino', v_tel is not null);
end; $$;

revoke all on function public.send_custom_message(uuid, text) from public;
grant execute on function public.send_custom_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Cambiar el WhatsApp del conductor y reparar sus avisos en cola
-- ---------------------------------------------------------------------------
-- El aviso guarda una copia del número porque debe conservar a dónde se envió.
-- Pero mientras siga en cola todavía no se ha enviado nada, así que corregir el
-- número del conductor debe corregir también esos avisos. Sin esto, un aviso
-- creado cuando el conductor no tenía número quedaba inservible para siempre,
-- incluso con la inspección todavía en curso.

create or replace function public.set_driver_whatsapp(
  p_driver_id uuid,
  p_whatsapp text
) returns jsonb
language plpgsql security definer
set search_path to 'public','app','pg_temp'
as $$
declare
  v_org uuid; v_old text; v_new text; v_reparados int := 0;
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','supervisor','superadmin') then
    raise exception 'No autorizado';
  end if;

  -- Sólo dígitos: el servidor no confía en la validación del navegador.
  v_new := regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g');
  if v_new <> '' and char_length(v_new) not between 7 and 15 then
    raise exception 'El número de WhatsApp debe tener entre 7 y 15 dígitos';
  end if;

  select nullif(btrim(whatsapp), '') into v_old
    from public.drivers
    where id = p_driver_id and organization_id = v_org
    for update;
  if not found then raise exception 'Conductor no encontrado'; end if;

  update public.drivers set whatsapp = v_new, updated_at = now()
    where id = p_driver_id and organization_id = v_org;

  -- Los avisos que aún no han salido se repuntan al número correcto. Los ya
  -- enviados NO se tocan: son el historial de a dónde se envió realmente.
  if v_new <> '' then
    update public.notifications
      set destinatario = v_new, estado = 'pendiente', ultimo_error = null
      where organization_id = v_org
        and driver_id = p_driver_id
        and estado in ('pendiente','sin_destino','fallido');
    get diagnostics v_reparados = row_count;
  end if;

  perform app.write_audit('driver_whatsapp_changed','driver',p_driver_id::text,
    jsonb_build_object('whatsapp', coalesce(v_old,'')),
    jsonb_build_object('whatsapp', v_new, 'avisos_reparados', v_reparados),
    null);

  return jsonb_build_object('ok', true, 'whatsapp', v_new, 'avisos_reparados', v_reparados);
end; $$;

revoke all on function public.set_driver_whatsapp(uuid, text) from public;
grant execute on function public.set_driver_whatsapp(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Borrado de ronda: incluir las novedades colgadas de la ronda
-- ---------------------------------------------------------------------------
-- `issues.round_id` apunta a la ronda directamente. Si una inspección se borró
-- antes por separado, su novedad quedó con `inspection_id` en NULL (la clave
-- foránea es ON DELETE SET NULL) pero conservando `round_id`. La versión
-- anterior sólo borraba novedades a través de la inspección, así que ésas
-- sobrevivían al borrado de la ronda y quedaban huérfanas en Novedades.

create or replace function public.delete_round(p_round_id uuid, p_password text)
returns jsonb
language plpgsql security definer
set search_path to 'public','app','pg_temp'
as $$
declare
  v_org uuid; v_label text; v_paths text[] := '{}'; v_count int;
  v_insp uuid[]; v_issues uuid[];
begin
  v_org := app.current_org();
  if v_org is null or not app.has_role('admin','superadmin') then
    raise exception 'No autorizado';
  end if;
  if not app.verify_admin_password(p_password) then
    raise exception 'La contraseña no es correcta';
  end if;

  select label into v_label from public.rounds
    where id = p_round_id and organization_id = v_org for update;
  if not found then raise exception 'Ronda no encontrada'; end if;

  -- Se resuelve de una sola vez qué se va a borrar, antes de tocar nada.
  select coalesce(array_agg(id), '{}') into v_insp
    from public.inspections where round_id = p_round_id and organization_id = v_org;
  v_count := coalesce(array_length(v_insp, 1), 0);

  select coalesce(array_agg(id), '{}') into v_issues
    from public.issues
    where organization_id = v_org
      and (round_id = p_round_id or inspection_id = any(v_insp));

  select coalesce(array_agg(storage_path), '{}') into v_paths
    from public.issue_evidence
    where organization_id = v_org
      and (inspection_id = any(v_insp) or issue_id = any(v_issues));

  delete from public.issue_evidence
    where organization_id = v_org
      and (inspection_id = any(v_insp) or issue_id = any(v_issues));
  delete from public.issues where id = any(v_issues);
  delete from public.inspection_answers where inspection_id = any(v_insp);
  delete from public.notifications where inspection_id = any(v_insp);
  delete from public.inspections where id = any(v_insp);
  delete from public.rounds where id = p_round_id and organization_id = v_org;

  perform app.write_audit('round_deleted','round',p_round_id::text,
    jsonb_build_object('label',v_label,'inspections',v_count,
                       'issues', coalesce(array_length(v_issues,1),0)),
    null, null);

  return jsonb_build_object(
    'id', p_round_id, 'label', v_label,
    'inspections_deleted', v_count,
    'issues_deleted', coalesce(array_length(v_issues,1),0),
    'storage_paths', to_jsonb(v_paths));
end; $$;

revoke all on function public.delete_round(uuid, text) from public;
grant execute on function public.delete_round(uuid, text) to authenticated;
