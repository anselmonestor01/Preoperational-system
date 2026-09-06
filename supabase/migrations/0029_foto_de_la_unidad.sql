-- =============================================================================
-- Migración 0029: fotografía de la unidad
-- -----------------------------------------------------------------------------
-- La lista de flota identificaba cada unidad con un icono de camión idéntico
-- para las setenta. A escala eso no distingue nada: setenta filas con el mismo
-- dibujo obligan a leer la placa carácter por carácter. Una foto real de la
-- unidad se reconoce antes de leerla, igual que ya ocurre con el retrato del
-- conductor.
--
-- Mismo patrón que `driver-photos`: bucket PRIVADO, ruta {org_id}/vehicles/…
-- y descarga por signed URL. La RLS de storage.objects ya existente cubre el
-- bucket nuevo al añadirlo a la lista de las cuatro políticas.
-- =============================================================================

alter table public.vehicles
  add column if not exists photo_path text;

comment on column public.vehicles.photo_path is
  'Ruta en el bucket privado vehicle-photos: {org_id}/vehicles/{vehicle_id}.jpg';

insert into storage.buckets (id, name, public)
values ('vehicle-photos','vehicle-photos', false)
on conflict (id) do update set public = false;

-- Las políticas se reescriben incluyendo el bucket nuevo. Se mantiene la regla
-- de fondo: el primer segmento de la ruta tiene que ser la organización de
-- quien pide, de modo que una empresa no puede alcanzar los objetos de otra.
drop policy if exists mm_evidence_select on storage.objects;
create policy mm_evidence_select on storage.objects for select to authenticated
  using (bucket_id in ('evidence','driver-photos','vehicle-photos')
         and (storage.foldername(name))[1] = app.current_org()::text);

drop policy if exists mm_evidence_insert on storage.objects;
create policy mm_evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('evidence','driver-photos','vehicle-photos')
         and (storage.foldername(name))[1] = app.current_org()::text);

drop policy if exists mm_evidence_update on storage.objects;
create policy mm_evidence_update on storage.objects for update to authenticated
  using (bucket_id in ('evidence','driver-photos','vehicle-photos')
         and (storage.foldername(name))[1] = app.current_org()::text);

drop policy if exists mm_evidence_delete on storage.objects;
create policy mm_evidence_delete on storage.objects for delete to authenticated
  using (bucket_id in ('evidence','driver-photos','vehicle-photos')
         and (storage.foldername(name))[1] = app.current_org()::text
         and app.has_role('admin','supervisor','superadmin'));
