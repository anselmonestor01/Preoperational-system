// Conductores: carga el listado y firma las URLs de sus fotos (bucket privado).
import { createClient } from "@/lib/supabase/server";
import DriversClient, { type DriverRow } from "./drivers-client";

export const dynamic = "force-dynamic";

export default async function ConductoresPage() {
  const supabase = createClient();
  const { data: drivers } = await supabase
    .from("drivers").select("id,full_name,license,whatsapp,photo_path,active").order("full_name");
  const { data: org } = await supabase.from("organizations").select("id").maybeSingle();

  const rows = (drivers ?? []) as DriverRow[];
  const paths = rows.filter((d) => d.photo_path).map((d) => d.photo_path!) as string[];
  const photoMap: Record<string, string> = {};
  if (paths.length) {
    const { data: signed } = await supabase.storage.from("driver-photos").createSignedUrls(paths, 3600);
    (signed ?? []).forEach((s) => { if (s.path && s.signedUrl) photoMap[s.path] = s.signedUrl; });
  }
  return <DriversClient rows={rows} photoMap={photoMap} orgId={org?.id ?? ""} />;
}
