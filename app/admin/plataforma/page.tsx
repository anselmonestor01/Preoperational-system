// Consola de plataforma: vigilar todas las empresas SIN ver sus datos.
//
// Lo que llega aquí son conteos y fechas. Ni una placa, ni un nombre de
// conductor, ni una foto. Esa limitación no es técnica: es lo que permite
// mirar a un cliente a la cara cuando pregunta si puedes ver su información.
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import PlataformaClient, { type FilaPlataforma } from "./plataforma-client";

export const dynamic = "force-dynamic";

export default async function PlataformaPage() {
  const perfil = await getProfile();
  if (!perfil) redirect("/login");
  if (!perfil.is_superadmin) redirect("/admin");

  const supabase = createClient();
  const { data, error } = await supabase.rpc("platform_overview");
  if (error) console.error("[plataforma] no se pudo leer el panorama:", error.message);

  return (
    <PlataformaClient
      filas={(data ?? []) as FilaPlataforma[]}
      errorLectura={error?.message ?? null}
    />
  );
}
