# Mundo Marítimo — Sistema Preoperacional

Sistema empresarial **multi-tenant** para gestionar inspecciones preoperacionales
de vehículos antes de iniciar operaciones. Convierte el prototipo HTML original en
una aplicación full-stack real, segura y desplegable.

- **Frontend:** Next.js 14 (App Router) + TypeScript
- **Backend / BD / Auth / Storage:** Supabase (PostgreSQL 17)
- **Deploy:** Vercel
- **Fuente de verdad:** Supabase. El navegador **nunca** es la fuente de verdad.

> Primer cliente: **Mundo Marítimo**. La arquitectura es multi-tenant desde el
> día uno: cada entidad pertenece a una `organization` y RLS impide que una
> empresa vea datos de otra.

---

## Arquitectura

```
Conductor (kiosco)                 Administración
   │  login operador (Auth)           │  login admin (Auth)
   ▼                                  ▼
/kiosco  ──┐                     /admin/*  ──┐
           │  @supabase/ssr (cookies)        │
           ▼                                  ▼
     ┌───────────────── Next.js (Vercel) ─────────────────┐
     │  Server Components (lectura RLS)                    │
     │  Client Components → RPC SECURITY DEFINER           │
     └───────────────────────┬────────────────────────────┘
                             ▼
     ┌──────────────── Supabase (PostgreSQL) ─────────────┐
     │  RLS multi-tenant · RPC (reglas de negocio) ·      │
     │  Storage privado (evidencias) · Auditoría append-only│
     └────────────────────────────────────────────────────┘
```

**Principio de seguridad:** las transiciones críticas (enviar inspección,
autorizar/rechazar, bloquear vehículo, rondas, novedades, versionar checklist)
se ejecutan en **funciones RPC `SECURITY DEFINER`** que validan rol y organización
en el servidor. El resultado de autorización se **recalcula siempre en la BD** —
manipular el cliente/DevTools no cambia el veredicto. Ver
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) y
[`docs/SECURITY.md`](docs/SECURITY.md).

---

## Modelo de datos (resumen)

`organizations · profiles(→auth.users) · drivers(pin_hash) · vehicles ·
checklist_categories · checklist_items(is_safety_critical) ·
checklist_versions(snapshot jsonb) · rounds · inspections(+operación embebida) ·
inspection_answers · issues · issue_evidence · audit_logs`

- **Multi-tenant:** `organization_id` en todas las tablas + RLS.
- **Versionado de checklist:** cada inspección guarda `checklist_version_id` y un
  **snapshot inmutable** — editar el checklist no reescribe inspecciones históricas.
- **Idempotencia:** `inspections.idempotency_key` único + índices parciales que
  evitan doble inspección por vehículo/ronda y más de una ronda abierta.
- **Operación embebida:** la operación (km inicial/final, combustible, recorrido,
  abierta/cerrada) vive en la inspección autorizada — sin duplicar datos.

---

## Roles

`superadmin · admin · supervisor · maintenance · auditor · operator` (kiosco).
Los **conductores** son una entidad propia y se verifican con **PIN** (bcrypt,
validado en servidor) sobre el dispositivo de kiosco autenticado.

---

## Puesta en marcha (local)

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env.local
#   Rellena NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY

# 3. Base de datos (si es un proyecto Supabase nuevo)
#    Aplica en orden los archivos de supabase/migrations/*.sql
#    y luego supabase/seed.sql (datos demo de Mundo Marítimo).

# 4. Desarrollo
npm run dev        # http://localhost:3000
```

Scripts: `npm run build`, `npm run start`, `npm run typecheck`, `npm run lint`.

---

## Credenciales demo (⚠️ cambiar en producción)

| Rol       | Correo                      | Contraseña           | Ruta     |
|-----------|-----------------------------|----------------------|----------|
| Admin     | `admin@mundomaritimo.com`   | `MundoMaritimo2026!` | `/admin` |
| Operador  | `operador@mundomaritimo.com`| `Kiosco2026!`        | `/kiosco`|

**PIN demo de conductores:** Juan Pérez `1234`, Carlos Rodríguez `2345`,
Ernesto Gómez `3456`, Luis Martínez `4567`, Jorge Ramírez `5678`,
Andrés Morales `6789`.

> Estos datos son **DEMO/SEED**, no datos reales. Cambie las contraseñas y los
> PIN antes de operar de verdad.

---

## Estructura del repositorio

```
app/                    Rutas Next.js (login, kiosco, admin/*, auth)
components/admin/       Shell del panel (sidebar, topbar)
lib/                    Clientes Supabase, tipos, helpers (checklist, formato)
supabase/migrations/    Migraciones SQL versionadas (0001..0006)
supabase/seed.sql       Datos demo de Mundo Marítimo
docs/                   Arquitectura, seguridad, QA
```

---

## Despliegue en Vercel

El proyecto se despliega enlazando este repositorio a Vercel. Variables de
entorno requeridas en Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

(Opcional, sólo server-side para futuras funciones de administración de usuarios:
`SUPABASE_SERVICE_ROLE_KEY` — **nunca** exponer al cliente.)
