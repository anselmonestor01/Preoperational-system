-- =============================================================================
-- MUNDO MARÍTIMO — Migración 0005: Storage (buckets privados + RLS)
-- -----------------------------------------------------------------------------
-- Las evidencias NUNCA son públicas. Convención de ruta: {org_id}/...  de modo
-- que la RLS de storage.objects sólo deja acceder a objetos de la propia
-- organización. La app descarga mediante signed URLs.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('evidence','evidence', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('driver-photos','driver-photos', false)
on conflict (id) do update set public = false;

-- Políticas: acceso sólo a objetos cuyo primer segmento de ruta = organización.
drop policy if exists mm_evidence_select on storage.objects;
create policy mm_evidence_select on storage.objects for select to authenticated
  using (bucket_id in ('evidence','driver-photos')
         and (storage.foldername(name))[1] = app.current_org()::text);

drop policy if exists mm_evidence_insert on storage.objects;
create policy mm_evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('evidence','driver-photos')
         and (storage.foldername(name))[1] = app.current_org()::text);

drop policy if exists mm_evidence_update on storage.objects;
create policy mm_evidence_update on storage.objects for update to authenticated
  using (bucket_id in ('evidence','driver-photos')
         and (storage.foldername(name))[1] = app.current_org()::text);

drop policy if exists mm_evidence_delete on storage.objects;
create policy mm_evidence_delete on storage.objects for delete to authenticated
  using (bucket_id in ('evidence','driver-photos')
         and (storage.foldername(name))[1] = app.current_org()::text
         and app.has_role('admin','supervisor','superadmin'));
