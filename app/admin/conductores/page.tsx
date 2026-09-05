// Conductores: carga el listado y firma las URLs de sus fotos (bucket privado).
//
// Añade el ESTADO OPERATIVO de cada uno, que es la pregunta que el panel no
// sabía responder: por qué el sistema le impide a alguien iniciar una
// inspección. La regla ya la impone la base —una operación abierta por
// conductor, y el vehículo tomado durante la ronda—; aquí se hace visible para
// que el administrador no tenga que adivinarla.
import { createClient } from "@/lib/supabase/server";
import DriversClient, { type DriverRow } from "./drivers-client";

export const dynamic = "force-dynamic";

export default async function ConductoresPage() {
  const supabase = createClient();

  const { data: round } = await supabase.from("rounds")
    .select("id,label").eq("status", "open")
    .order("round_number", { ascending: false }).limit(1).maybeSingle();

  const [{ data: drivers }, { data: org }, { data: enRuta }, { data: enRonda }] = await Promise.all([
    supabase.from("drivers").select("id,full_name,license,whatsapp,photo_path,active").order("full_name"),
    supabase.from("organizations").select("id").maybeSingle(),
    // Operación abierta: salió y no ha registrado el regreso.
    supabase.from("inspections")
      .select("driver_id,vehicle_plate,submitted_at").eq("operation_status", "open"),
    // Ya operó en la ronda vigente: el perfil queda consumido hasta la siguiente.
    round
      ? supabase.from("inspections")
          .select("driver_id,vehicle_plate,authorized,submitted_at")
          .eq("round_id", round.id).neq("status", "in_progress").neq("status", "voided")
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const rows = (drivers ?? []) as DriverRow[];
  const paths = rows.filter((d) => d.photo_path).map((d) => d.photo_path!) as string[];
  const photoMap: Record<string, string> = {};
  if (paths.length) {
    const { data: signed } = await supabase.storage.from("driver-photos").createSignedUrls(paths, 3600);
    (signed ?? []).forEach((s) => { if (s.path && s.signedUrl) photoMap[s.path] = s.signedUrl; });
  }

  const ruta: Record<string, { placa: string; desde: string | null }> = {};
  (enRuta ?? []).forEach((o: any) => {
    if (o.driver_id) ruta[o.driver_id] = { placa: o.vehicle_plate ?? "—", desde: o.submitted_at };
  });
  const ronda: Record<string, { placa: string; autorizada: boolean | null }> = {};
  (enRonda ?? []).forEach((o: any) => {
    if (o.driver_id && !ruta[o.driver_id]) {
      ronda[o.driver_id] = { placa: o.vehicle_plate ?? "—", autorizada: o.authorized };
    }
  });

  return (
    <DriversClient
      rows={rows} photoMap={photoMap} orgId={org?.id ?? ""}
      enRuta={ruta} yaOperaron={ronda} rondaLabel={round?.label ?? null}
    />
  );
}
