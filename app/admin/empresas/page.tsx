// Alta de empresas. Sólo para el dueño del sistema.
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import EmpresasClient, { type EmpresaRow } from "./empresas-client";

export const dynamic = "force-dynamic";

export default async function EmpresasPage() {
  const perfil = await getProfile();
  if (!perfil) redirect("/login");
  // Crear empresas está por encima de administrar una. La base de datos lo
  // vuelve a comprobar en `create_organization`: esto es sólo para no mostrar
  // una pantalla que igualmente sería rechazada.
  if (!perfil.is_superadmin) redirect("/admin");

  const supabase = createClient();
  const { data } = await supabase
    .from("organizations")
    .select("id,name,slug,timezone,max_non_critical_bad,active,created_at,plan,billing_status")
    .order("name");

  return (
    <EmpresasClient
      empresas={(data ?? []) as EmpresaRow[]}
      empresaActiva={perfil.organization_id}
    />
  );
}
