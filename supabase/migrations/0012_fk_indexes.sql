-- =============================================================================
-- PREOPERATIONAL SYSTEM — Migración 0012
-- Índices de cobertura para las claves foráneas que no los tenían.
--
-- Por qué importa: PostgreSQL no indexa las FK automáticamente. Sin índice,
-- cada borrado o join por esa columna obliga a recorrer la tabla entera. Afecta
-- especialmente a la depuración de historial (delete_round / delete_inspection),
-- que borra en cascada por inspection_id y round_id.
--
-- Detectado por el linter de rendimiento de Supabase (unindexed_foreign_keys).
-- =============================================================================

-- Cascada de borrado y consultas de detalle (las más críticas)
create index if not exists idx_issues_inspection_id           on public.issues(inspection_id);
create index if not exists idx_issues_round_id                on public.issues(round_id);
create index if not exists idx_issue_evidence_inspection_id   on public.issue_evidence(inspection_id);

-- Relaciones de negocio usadas en reportes y filtros
create index if not exists idx_inspections_driver_id          on public.inspections(driver_id);
create index if not exists idx_inspections_checklist_version  on public.inspections(checklist_version_id);
create index if not exists idx_issues_driver_id               on public.issues(driver_id);
create index if not exists idx_issues_assigned_to             on public.issues(assigned_to);
create index if not exists idx_drivers_profile_id             on public.drivers(profile_id);

-- Trazabilidad (quién creó / cerró / anuló cada registro)
create index if not exists idx_audit_logs_actor_profile_id    on public.audit_logs(actor_profile_id);
create index if not exists idx_checklist_versions_created_by  on public.checklist_versions(created_by);
create index if not exists idx_drivers_created_by             on public.drivers(created_by);
create index if not exists idx_inspections_created_by         on public.inspections(created_by);
create index if not exists idx_inspections_voided_by          on public.inspections(voided_by);
create index if not exists idx_issue_evidence_created_by      on public.issue_evidence(created_by);
create index if not exists idx_issues_resolved_by             on public.issues(resolved_by);
create index if not exists idx_rounds_started_by              on public.rounds(started_by);
create index if not exists idx_rounds_closed_by               on public.rounds(closed_by);
create index if not exists idx_vehicles_blocked_by            on public.vehicles(blocked_by);
