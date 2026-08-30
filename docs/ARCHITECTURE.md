# Arquitectura — Sistema Preoperacional

## Capas

1. **Next.js (Vercel).**
   - *Server Components* leen datos con la sesión del usuario (cookies vía
     `@supabase/ssr`); RLS limita cada lectura a su organización.
   - *Client Components* ejecutan mutaciones llamando **RPC** (nunca escriben
     directamente en tablas críticas).
   - `middleware.ts` refresca la sesión y protege `/admin` y `/kiosco`.

2. **Supabase / PostgreSQL.**
   - **RLS** en todas las tablas de negocio (multi-tenant por `organization_id`).
   - **RPC `SECURITY DEFINER`** con la lógica de negocio y las transiciones de
     estado (única vía de escritura para inspecciones, rondas, novedades, etc.).
   - **Storage** privado para evidencias, con RLS por prefijo de organización.
   - **Auditoría** append-only.

## Entidades y relaciones

```
organizations 1─┬─* profiles (→ auth.users)
                ├─* drivers                (pin_hash bcrypt)
                ├─* vehicles
                ├─* checklist_categories 1─* checklist_items
                ├─* checklist_versions     (snapshot jsonb inmutable)
                ├─* rounds
                ├─* inspections ─┬─* inspection_answers
                │                └─* issues 1─* issue_evidence (Storage)
                └─* audit_logs
```

## Máquina de estados de la inspección

```
in_progress ──submit──► authorized ──register_return──► closed
      │            └──► rejected  (vehículo bloqueado)
      └───────────────► (draft; recuperable)
cualquiera ──void──► voided        (no cuenta en reportes)
override_authorization: rejected ⇄ authorized (auditable, sólo admin)
release_inspection: libera el vehículo para re-inspección en la ronda
```

### Reglas de autorización (server-side, deterministas)
- Ítem **crítico de seguridad** (`checklist_items.is_safety_critical`) en severidad
  `bad` ⇒ **NO AUTORIZADO**.
- Acumulación de fallas `bad` no críticas ≥ `organizations.max_non_critical_bad`
  ⇒ **NO AUTORIZADO**.
- Resultado: `bueno` (sin warn/bad) · `regular` (sólo warn) · `malo` (algún bad).
- `authorized = (sin razones de bloqueo)`. Se recalcula en `submit_inspection`.

## Concurrencia e idempotencia
- `pg_advisory_xact_lock(org, vehicle)` serializa envíos del mismo vehículo.
- `SELECT ... FOR UPDATE` sobre ronda y vehículo.
- Índices únicos parciales:
  - una inspección válida por `(vehicle_id, round_id)`,
  - un borrador por `(vehicle_id, round_id)`,
  - una ronda abierta por organización,
  - `idempotency_key` única por organización.
- `submit_inspection` es idempotente: reenvío con la misma clave devuelve la
  inspección existente.

## Tiempo
Todos los timestamps críticos provienen de `now()` (servidor). La UI presenta en
zona `America/Bogota`. El reloj del cliente no afecta la integridad.

## Versionado del checklist
`publish_checklist_version` congela las categorías/ítems activos en un snapshot
jsonb y lo marca como versión activa. Cada inspección guarda el número y el
snapshot usado; editar el checklist no altera inspecciones históricas.
