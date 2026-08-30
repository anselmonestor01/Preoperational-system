# Despliegue — Sistema Preoperacional

## Estado actual

- **Base de datos (Supabase):** ✅ desplegada y verificada en el proyecto
  `vkduxheifqmomtazolku` (migraciones 0001–0006 aplicadas + seed).
- **Código (GitHub):** ✅ en `anselmonestor01/Preoperational-system`, rama
  `claude/mundo-maritimo-enterprise-6py8ty`.
- **Vercel:** requiere **un paso único de autorización** (conectar GitHub), que
  sólo puede hacer el dueño de la cuenta — ver abajo.

## Por qué Vercel necesita una acción manual (una sola vez)

El despliegue automático GitHub→Vercel requiere que la **Vercel GitHub App** esté
instalada/autorizada en la cuenta de GitHub. Esa autorización es un consentimiento
OAuth a nivel de cuenta que no puede otorgarse por API/token de terceros. Una vez
concedida, cada `git push` despliega solo.

> El proyecto **no necesita configurar variables de entorno** para arrancar: la
> URL y la clave *publishable* de Supabase (públicas por diseño) están como valor
> por defecto en `lib/supabase/config.ts`. Aun así, se recomienda definirlas como
> variables de entorno en producción (override).

## Opción A — Importar el repo en Vercel (recomendada, ~2 min)

1. Entra a <https://vercel.com/new>.
2. **Import Git Repository** → conecta GitHub y elige
   `anselmonestor01/Preoperational-system`.
   (La primera vez, GitHub pedirá autorizar la Vercel GitHub App.)
3. **Production Branch:** selecciona `claude/mundo-maritimo-enterprise-6py8ty`
   (o fusiona esa rama a `main` y usa `main`).
4. Framework: **Next.js** (autodetectado). No cambies build/output.
5. (Opcional) *Environment Variables*:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://vkduxheifqmomtazolku.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `sb_publishable_0qxowk5wAIYyUvfMzK6qCg_YQATb8uT`
6. **Deploy.** Al terminar tendrás la URL pública.

## Opción B — Vincular un proyecto ya creado

Ya existe un proyecto `mundo-maritimo-app` en el equipo de Vercel. Puedes, en su
**Settings → Git**, conectar el repositorio `anselmonestor01/Preoperational-system`
y fijar la Production Branch, luego **Redeploy**.

## Verificación post-deploy (QA de producción)

Abre la URL y comprueba:

1. **/login** carga con la identidad visual.
2. Admin: `admin@navierapacifico.com` / `Preoperacional2026!` → `/admin` con KPIs reales.
3. Operador: `operador@navierapacifico.com` / `Kiosco2026!` → `/kiosco`.
4. Flujo conductor: conductor + PIN (`Juan Pérez`/`1234`) → vehículo → datos →
   checklist → resumen → envío → resultado.
5. Cambia las credenciales demo y los PIN antes de operar de verdad.

## Migraciones en un proyecto Supabase nuevo

Aplica en orden `supabase/migrations/0001…0006.sql` y luego `supabase/seed.sql`
(CLI de Supabase o el editor SQL del dashboard).
