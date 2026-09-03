// Alta de empresas — ahora dentro de la consola, no del panel de cliente.
import { requireConsola } from "@/lib/consola";
import { createClient } from "@/lib/supabase/server";
import ConsolaShell from "@/components/consola/ConsolaShell";
import EmpresasClient, { type EmpresaRow } from "./empresas-client";

export const dynamic = "force-dynamic";

export default async function ConsolaEmpresasPage() {
  const perfil = await requireConsola();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,slug,timezone,max_non_critical_bad,active,created_at,plan,billing_status")
    .order("name");
  if (error) console.error("[consola] no se pudo listar empresas:", error.message);

  return (
    <ConsolaShell quien={perfil.email}>
      <EmpresasClient
        empresas={(data ?? []) as EmpresaRow[]}
        empresaActiva={perfil.organization_id}
        errorLectura={error?.message ?? null}
      />
    </ConsolaShell>
  );
}
