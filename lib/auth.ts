// Helpers de sesión y autorización por rol para Server Components.
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

// Perfil del usuario autenticado (server-side). null si no hay sesión válida.
//
// Se resuelve con el RPC `me()` en vez de leer la tabla de perfiles porque la
// empresa activa NO es un campo del perfil: es el resultado de validar la
// empresa elegida contra las pertenencias del usuario. Hacerlo en la base evita
// que el navegador pueda decir "estoy en la empresa X" sin pertenecer a ella.
//
// UNA SOLA IDA Y VUELTA, NO DOS
// Antes esto llamaba a `auth.getUser()` y DESPUÉS a `me()`. `getUser()` no lee
// una cookie: es una petición de red al servidor de Auth, y se pagaba en cada
// navegación además de la que ya hace el middleware. No aportaba seguridad:
// `me()` filtra por `auth.uid()`, que sale de los claims del JWT que PostgREST
// verifica —firma y caducidad— antes de ejecutar nada. Sin sesión válida,
// `auth.uid()` es null, no hay filas y esto devuelve null igual. La sesión se
// sigue validando y refrescando en el middleware, que es su sitio.
//
// `cache()` la memoriza durante la petición: el layout y la página que también
// la pide (configuración, QR, usuarios) comparten el mismo resultado en vez de
// preguntar dos veces.
export const getProfile = cache(async function getProfile(): Promise<Profile | null> {
  const supabase = createClient();

  // Sin cookie de sesión no hay nada que preguntar. `getSession()` la lee en
  // local, sin red. NO se usa para autorizar —de eso se encargan el middleware,
  // que valida contra el servidor de Auth, y PostgREST, que verifica la firma
  // del JWT— sino para no gastar una petición que además saldría 403: `anon` no
  // tiene permiso de ejecutar `me()`, y eso llenaría el registro de errores en
  // cada visita anónima a /login.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const { data, error } = await supabase.rpc("me").maybeSingle();
  if (error) {
    console.error("[auth] no se pudo resolver el contexto de sesión:", error.message);
    return null;
  }
  if (!data || !(data as Profile).active) return null;
  return data as Profile;
});

// Ruta de inicio según rol.
export function roleHome(role: Role): string {
  return role === "operator" || role === "driver" ? "/kiosco" : "/admin";
}

// Roles con acceso al panel administrativo.
export const ADMIN_ROLES: Role[] = [
  "admin", "supervisor", "maintenance", "auditor", "superadmin",
];

// Roles con acceso al kiosco del patio. Deliberadamente NO incluye a los
// administrativos: el kiosco es el dispositivo compartido donde los conductores
// se identifican con su PIN, y esa cadena de responsabilidad se rompería si
// alguien pudiera inspeccionar desde su propia sesión administrativa.
export const KIOSK_ROLES: Role[] = ["operator", "driver"];
