import { createClient } from "@/lib/supabase/server";
import VehiclesClient from "./vehicles-client";

export const dynamic = "force-dynamic";

export default async function VehiculosPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("vehicles")
    .select("id,plate,reference,model,operation_card,insurance_expires,emissions_expires,oil_change_date,status,admin_blocked,admin_block_reason,blocked_at")
    .order("plate");
  const { data: issues } = await supabase.from("issues").select("vehicle_id").neq("status", "resolved");
  const openBy: Record<string, number> = {};
  (issues ?? []).forEach((r: any) => { openBy[r.vehicle_id] = (openBy[r.vehicle_id] ?? 0) + 1; });
  return <VehiclesClient initial={data ?? []} openBy={openBy} />;
}
