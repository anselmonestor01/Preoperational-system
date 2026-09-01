// Helpers de sesión y autorización por rol para Server Components.
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

// Perfil del usuario autenticado (server-side). null si no hay sesión válida.
export async function getProfile(): Promise<Profile | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id,organization_id,role,full_name,email,active")
    .eq("id", user.id)
    .maybeSingle();
  if (!data || !data.active) return null;
  return data as Profile;
}

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
