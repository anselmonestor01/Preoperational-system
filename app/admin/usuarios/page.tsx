// Usuarios: quién puede entrar al sistema y con qué permisos.
// Distinto de "Conductores": un conductor se identifica con PIN en el kiosco;
// un usuario inicia sesión con correo y contraseña.
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import UsersClient, { type UserRow } from "./users-client";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const supabase = createClient();
  const me = await getProfile();

  const { data } = await supabase
    .from("profiles")
    .select("id,full_name,email,role,active,created_at")
    .order("role")
    .order("full_name");

  return <UsersClient rows={(data ?? []) as UserRow[]} myId={me?.id ?? ""} />;
}
