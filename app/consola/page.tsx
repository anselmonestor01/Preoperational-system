// Consola de plataforma — resumen.
//
// Lo que llega aquí son conteos y fechas. Ni una placa, ni un nombre de
// conductor, ni una foto. Esa limitación no es técnica: es lo que permite
// mirar a un cliente a la cara cuando pregunta si puedes ver su información.
import { requireConsola } from "@/lib/consola";
import { createClient } from "@/lib/supabase/server";
import ConsolaShell from "@/components/consola/ConsolaShell";
import ResumenClient, { type FilaPlataforma } from "./resumen-client";

export const dynamic = "force-dynamic";

export default async function ConsolaResumenPage() {
  const perfil = await requireConsola();
  const supabase = createClient();

  const { data, error } = await supabase.rpc("platform_overview");
  if (error) console.error("[consola] no se pudo leer el panorama:", error.message);

  return (
    <ConsolaShell quien={perfil.email}>
      <ResumenClient
        filas={(data ?? []) as FilaPlataforma[]}
        errorLectura={error?.message ?? null}
      />
    </ConsolaShell>
  );
}
