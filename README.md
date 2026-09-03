# Preoperational System — Gestión de Flotas

Sistema empresarial **multi-tenant** para gestionar inspecciones preoperacionales
de vehículos antes de iniciar operaciones. Convierte el prototipo HTML original en
una aplicación full-stack real, segura y desplegable.

- **Frontend:** Next.js 14 (App Router) + TypeScript
- **Backend / BD / Auth / Storage:** Supabase (PostgreSQL 17)
- **Deploy:** Vercel
- **Fuente de verdad:** Supabase. El navegador **nunca** es la fuente de verdad.

> Producto multi-tenant desde el día uno: cada entidad pertenece a una
> `organization` y RLS impide que una empresa vea datos de otra. El tenant de
> demostración incluido (**Naviera del Pacífico S.A.**) es un cliente ficticio
> usado solo para pruebas y presentaciones — el producto en sí no está atado
> a ninguna empresa.

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
inspection_answers · issues · issue_evidence · driver_claims · notifications ·
audit_logs`

- **Multi-tenant:** `organization_id` en todas las tablas + RLS.
- **Versionado de checklist:** cada inspección guarda `checklist_version_id` y un
  **snapshot inmutable** — editar el checklist no reescribe inspecciones históricas.
- **Idempotencia:** `inspections.idempotency_key` único + índices parciales que
  evitan doble inspección por vehículo/ronda y más de una ronda abierta.
- **Operación embebida:** la operación (km inicial/final, combustible, recorrido,
  abierta/cerrada) vive en la inspección autorizada — sin duplicar datos.
- **Un perfil, un dispositivo:** `driver_claims` reserva el perfil del conductor
  para el equipo donde escribió su PIN, de modo que dos teléfonos no pueden
  inspeccionar con la misma identidad. La reserva caduca sola a los 45 minutos.
- **Varias empresas por usuario:** `organization_members` dice a qué empresas
  entra cada persona y con qué rol en cada una. `app.current_org()` devuelve la
  empresa activa, validada contra esa tabla, así que las 25 políticas RLS y los
  33 RPC pasaron a ser multiempresa sin cambiar ni una línea de ellos. El kiosco
  no lleva selector a propósito: la tableta de una portería es de esa empresa.
- **Consola de plataforma, aparte y bajo otra llave:** vive en `/consola`, no
  en el panel de cliente, con su propio diseño y su propia clave. Entrar exige
  las dos cosas a la vez: sesión de un usuario `superadmin` **y** la clave de
  consola, canjeada por una sesión de 8 horas cuyo identificador viaja en una
  cookie `httpOnly` atada a ese usuario. El hash de la clave vive en el esquema
  `app`, que PostgREST no expone. Lo que se ve dentro lo da
  `platform_overview()`: conteos y fechas de todas las empresas — nunca placas,
  nombres de conductor ni fotos. Contar sí; leer no. A quien no es
  superadministrador la dirección le responde 404, no 403.
- **Un conductor, una salida a la vez:** mientras no registre el regreso, no
  puede iniciar otra inspección. Lo impone un disparador sobre `inspections`
  (`app.una_operacion_por_conductor`), así que vale para cualquier vía de
  escritura y no sólo para `submit_inspection`. El kiosco lo muestra antes: el
  conductor aparece bloqueado en la lista, con la placa y la hora de salida. Si
  un vehículo nunca vuelve, el administrador libera al conductor anulando la
  inspección desde el panel.
- **Avisos en bandeja de salida:** `notifications` encola los mensajes de
  WhatsApp. Una inspección nunca falla porque el proveedor de mensajería esté
  caído; el aviso se envía después.

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
#    y luego supabase/seed.sql (datos demo).

# 4. Desarrollo
npm run dev        # http://localhost:3000
```

Scripts: `npm run build`, `npm run start`, `npm run typecheck`, `npm run lint`.

---

## Credenciales demo (⚠️ cambiar en producción)

| Rol       | Correo                      | Contraseña           | Ruta     |
|-----------|-----------------------------|----------------------|----------|
| Admin     | `admin@navierapacifico.com`   | `Preoperacional2026!` | `/admin` |
| Operador  | `operador@navierapacifico.com`| `Kiosco2026!`         | `/kiosco`|

**Conductores y vehículos:** se dan de alta desde el panel de administración
(*Conductores* y *Vehículos*). Cada conductor define su propio PIN de 4 dígitos,
que se guarda con bcrypt y sólo puede revelarlo un administrador (acción auditada).

> Las credenciales de acceso son **DEMO/SEED**, no datos reales. Cámbielas antes
> de operar de verdad.

---

## Estructura del repositorio

```
app/                    Rutas Next.js (login, kiosco, admin/*, auth)
app/consola/            Consola de plataforma: otra dirección, otra clave, otro diseño
components/admin/       Shell del panel de cliente (sidebar, topbar)
components/consola/     Shell de la consola (barra superior)
lib/                    Clientes Supabase, tipos, helpers (checklist, formato)
supabase/migrations/    Migraciones SQL versionadas (0001..0024)
supabase/seed.sql       Datos demo (cliente ficticio de prueba)
supabase/tests/         Pruebas de las reglas de negocio en PostgreSQL
tests/                  Pruebas unitarias del cliente (Vitest)
docs/                   Arquitectura, seguridad, QA
```

### Pruebas

```bash
npm test                                                    # 71 pruebas del cliente
psql "$DATABASE_URL" -f supabase/tests/rules.test.sql        # 18 reglas de negocio
psql "$DATABASE_URL" -f supabase/tests/aislamiento.test.sql  # 14 de aislamiento
psql "$DATABASE_URL" -f supabase/tests/consola.test.sql      # 24 de la clave de consola
```

Las pruebas SQL corren dentro de una transacción que se **revierte**: no dejan
ni un registro. Ya encontraron un fallo real (ningún ítem del checklist estaba
marcado como crítico, así que el sistema autorizaba un camión sin frenos).

---

## Despliegue en Vercel

El proyecto se despliega enlazando este repositorio a Vercel. Variables de
entorno requeridas en Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Opcionales, **sólo server-side** (nunca con el prefijo `NEXT_PUBLIC_`):

| Variable | Para qué |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Envío automático de avisos (`/api/notificaciones`). |
| `NOTIFY_SECRET` | Secreto que autoriza a disparar ese envío. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | Cuenta de WhatsApp Business API. |

Sin esas variables el sistema **funciona igual**: los avisos se envían a mano
desde *Avisos*, con un toque y sin costo. Ver la sección siguiente.

---

## Avisos de WhatsApp

Cada vez que un vehículo sale autorizado, el sistema encola un recordatorio para
que el conductor registre su regreso. Hay dos formas de que salga:

1. **Enlace `wa.me` (activo desde el primer día, gratis).** En *Avisos*, el botón
   «Abrir en WhatsApp» abre la conversación con el texto ya escrito; «Marcar como
   enviado» deja constancia. Desde ahí también se puede escribir un mensaje
   personalizado a cualquier conductor y corregirle el número —incluso con una
   inspección en curso—, lo que repara automáticamente sus avisos en cola.
2. **WhatsApp Business API (automático).** Requiere cuenta de empresa y plantillas
   aprobadas por Meta. Al configurar las variables de arriba, `/api/notificaciones`
   vacía la cola sin intervención humana.

---

## Acceso por QR

*Acceso QR* genera un cartel imprimible para la portería. El código contiene
**únicamente la dirección del kiosco**: ninguna clave, ningún token. Quien lo
escanee sigue necesitando una sesión iniciada en el dispositivo del patio y el
PIN personal del conductor. Se descartó a propósito incluir un token de acceso:
un cartel a la vista de todos habría sido, en la práctica, una contraseña pegada
a la pared.
