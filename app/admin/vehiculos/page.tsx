// Vehículos: lee el estado desde `vehicle_status_view`, la ÚNICA fuente de
// verdad de disponibilidad (compartida con el kiosco).
import { createClient } from "@/lib/supabase/server";
import VehiclesClient, { type VehicleRow } from "./vehicles-client";

export const dynamic = "force-dynamic";

export default async function VehiculosPage() {
  const supabase = createClient();
  const [{ data: rows }, { data: ops }, { data: round }] = await Promise.all([
    supabase.from("vehicle_status_view").select("*").order("plate"),
    supabase.from("inspections").select("vehicle_id").eq("operation_status", "open"),
    supabase.from("rounds").select("label").eq("status", "open").order("round_number", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const opsBy: Record<string, number> = {};
  (ops ?? []).forEach((o: any) => { opsBy[o.vehicle_id] = (opsBy[o.vehicle_id] ?? 0) + 1; });
  return <VehiclesClient rows={(rows ?? []) as VehicleRow[]} opsBy={opsBy} roundLabel={round?.label ?? "—"} />;
}
