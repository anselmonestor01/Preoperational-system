import { createClient } from "@/lib/supabase/server";
import DriversClient from "./drivers-client";

export const dynamic = "force-dynamic";

export default async function ConductoresPage() {
  const supabase = createClient();
  // Solo conductores activos: "Eliminar" los saca de esta lista (active=false).
  const { data } = await supabase
    .from("drivers")
    .select("id,full_name,license,whatsapp,photo_path,active")
    .eq("active", true)
    .order("full_name");
  return <DriversClient initial={data ?? []} />;
}
