// Vehículos: lee el estado desde `vehicle_status_view`, la ÚNICA fuente de
// verdad de disponibilidad (compartida con el kiosco).
//
// A escala añade dos datos que la vista no trae y que los filtros rápidos
// necesitan: qué unidades salieron hoy y cuáles siguen fuera.
import { createClient } from "@/lib/supabase/server";
import VehiclesClient, { type VehicleRow } from "./vehicles-client";

export const dynamic = "force-dynamic";

/** Franja del día en curso en hora de Bogotá, que es la que ve la operación. */
function diaBogota() {
  const dia = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return {
    desde: new Date(`${dia}T00:00:00-05:00`).toISOString(),
    hasta: new Date(`${dia}T23:59:59-05:00`).toISOString(),
  };
}

export default async function VehiculosPage({
  searchParams,
}: { searchParams: { f?: string } }) {
  const supabase = createClient();
  const { desde, hasta } = diaBogota();
  const [{ data: rows }, { data: ops }, { data: round }, { data: hoy }] = await Promise.all([
    supabase.from("vehicle_status_view").select("*").order("plate"),
    supabase.from("inspections").select("vehicle_id").eq("operation_status", "open"),
    supabase.from("rounds").select("label").eq("status", "open").order("round_number", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("inspections").select("vehicle_id")
      .gte("submitted_at", desde).lte("submitted_at", hasta)
      .neq("status", "in_progress").neq("status", "voided"),
  ]);
  const opsBy: Record<string, number> = {};
  (ops ?? []).forEach((o: any) => { opsBy[o.vehicle_id] = (opsBy[o.vehicle_id] ?? 0) + 1; });
  const inspeccionadosHoy = Array.from(new Set((hoy ?? []).map((h: any) => h.vehicle_id).filter(Boolean)));
  return (
    <VehiclesClient
      rows={(rows ?? []) as VehicleRow[]}
      opsBy={opsBy}
      roundLabel={round?.label ?? "—"}
      inspeccionadosHoy={inspeccionadosHoy}
      filtroInicial={searchParams.f ?? "todos"}
    />
  );
}
