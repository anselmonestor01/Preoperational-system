# Despliegue — Preoperational System

## Estado actual

- **Base de datos (Supabase):** ✅ desplegada y verificada en el proyecto
  `vkduxheifqmomtazolku` (migraciones 0001–0010 aplicadas + seed).
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

Si ya existe un proyecto en el equipo de Vercel, puedes, en su
**Settings → Git**, conectar el repositorio `anselmonestor01/Preoperational-system`
y fijar la Production Branch, luego **Redeploy**.

## Verificación post-deploy (QA de producción)

Abre la URL y comprueba:

1. **/login** carga con la identidad visual.
2. Admin: entra con la cuenta de administrador → `/admin` con KPIs reales.
3. Operador: entra con la cuenta de operador → `/kiosco`.
4. Flujo conductor: conductor + su PIN de 4 dígitos → vehículo → datos →
   checklist → resumen → envío → resultado.
5. Consola de plataforma: `/consola`. Pide la clave de consola, aparte del
   inicio de sesión. La primera vez la establece el propio superadministrador.

Las contraseñas se consultan y se cambian en Supabase → Authentication → Users.
No se escriben en este documento ni en ningún archivo del repositorio: lo que
entra en Git se queda en el historial aunque luego se borre.

## Migraciones en un proyecto Supabase nuevo

Aplica en orden `supabase/migrations/0001…0010.sql` y luego `supabase/seed.sql`
(CLI de Supabase o el editor SQL del dashboard).
