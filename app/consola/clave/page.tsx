// Cambiar la clave de consola.
import { requireConsola } from "@/lib/consola";
import ConsolaShell from "@/components/consola/ConsolaShell";
import ClaveClient from "./clave-client";

export const dynamic = "force-dynamic";

export default async function ConsolaClavePage() {
  const perfil = await requireConsola();
  return (
    <ConsolaShell quien={perfil.email}>
      <ClaveClient />
    </ConsolaShell>
  );
}
