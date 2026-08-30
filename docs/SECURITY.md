# Seguridad — Mundo Marítimo

La seguridad vive en **backend + base de datos + RLS**, nunca en ocultar botones.

## Multi-tenant / IDOR
- Toda tabla de negocio tiene RLS: `organization_id = app.current_org()`, donde
  `app.current_org()` deriva la organización del **perfil del usuario autenticado**
  (JWT), no de ningún ID enviado por el cliente.
- Los RPC vuelven a resolver la organización desde `auth.uid()` y filtran por ella;
  ignoran cualquier `organization_id` del payload.
- Un usuario de la empresa A no puede leer ni modificar filas de la empresa B,
  aunque manipule IDs (`vehicle_id`, `inspection_id`, etc.).

## Autorización vertical (roles)
- RLS y RPC comprueban rol con `app.has_role(...)`.
- Escrituras críticas sólo por RPC `SECURITY DEFINER` con verificación de rol:
  - `override_authorization`, `void_inspection` → `admin`/`superadmin`.
  - `set_vehicle_block`, `start_round`, `close_round`, `release_inspection` →
    `admin`/`supervisor`/`superadmin`.
  - `set_issue_status` → `admin`/`supervisor`/`maintenance`/`superadmin`.
  - `submit_inspection`, `register_return`, `verify_driver_pin` → incluye `operator`.

## Usuarios desactivados
`app.current_org()`/`app.is_active()` sólo consideran perfiles `active = true`;
un usuario desactivado no puede leer ni escribir nada.

## Autenticación
- **Supabase Auth** (email/contraseña) para usuarios del panel y del kiosco.
- **Conductores:** PIN de 4 dígitos con **hash bcrypt** (`pgcrypto`) verificado en
  `verify_driver_pin` (server-side). El PIN nunca vive en el cliente ni en el repo.
- El hash del PIN **no es legible** por clientes: se revocó el privilegio de
  columna `drivers.pin_hash` a `authenticated`; sólo lo leen funciones definer.

## Resultado no manipulable
`submit_inspection` recalcula severidades, razones de bloqueo, resultado y
`authorized` en la BD a partir de las respuestas + criticidad del checklist.
Cambiar variables en DevTools (`authorized = true`) no tiene efecto: el servidor
decide y persiste el veredicto.

## Idempotencia / doble envío / concurrencia
- `idempotency_key` única + índices únicos parciales + `advisory lock` +
  `FOR UPDATE`. Ver `docs/ARCHITECTURE.md`.

## Storage
- Buckets `evidence` y `driver-photos` **privados**.
- RLS en `storage.objects`: sólo objetos cuyo primer segmento de ruta es la
  organización del usuario. Descarga mediante **signed URLs** temporales.

## Auditoría
- `audit_logs` es **append-only**: no hay políticas de `insert/update/delete` para
  usuarios; sólo escriben las funciones definer (`app.write_audit`). Lectura sólo
  para `admin`/`auditor`/`superadmin`.

## Endurecimiento adicional
- `EXECUTE` de los RPC revocado a `anon`/`public`; sólo `authenticated`.
- `search_path` fijado en funciones.
- `service_role` **no** se usa en el cliente.

## Pendientes recomendados (hardening futuro)
- Rate-limiting de `verify_driver_pin` (p. ej. bloqueo tras N intentos) — hoy se
  auditan los intentos fallidos (`driver_pin_failed`).
- MFA para roles administrativos (soportado por Supabase Auth).
