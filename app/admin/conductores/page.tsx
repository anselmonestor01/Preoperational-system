import { createClient } from "@/lib/supabase/server";
import DriversClient from "./drivers-client";

export const dynamic = "force-dynamic";

export default async function ConductoresPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("drivers").select("id,full_name,license,whatsapp,photo_path,active").order("full_name");
  return <DriversClient initial={data ?? []} />;
}
