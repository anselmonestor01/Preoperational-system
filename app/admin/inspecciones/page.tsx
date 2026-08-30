import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fmtKm } from "@/lib/format";
import InspectionActions from "./inspection-actions";

export const dynamic = "force-dynamic";
const PAGE = 25;

export default async function InspeccionesPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string; page?: string };
}) {
  const supabase = createClient();
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const status = searchParams.status ?? "all";
  const q = (searchParams.q ?? "").trim();

  let query = supabase
    .from("inspections")
    .select("id,vehicle_plate,driver_name,result,authorized,status,operation_status,km_inicial,km_final,recorrido,submitted_at,checklist_version_number,bad_count,warn_count", { count: "exact" })
    .neq("status", "in_progress")
    .order("created_at", { ascending: false });

  if (status !== "all") query = query.eq("status", status);
  if (q) query = query.ilike("vehicle_plate", `%${q}%`);
  query = query.range((page - 1) * PAGE, page * PAGE - 1);

  const { data, count } = await query;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  const chip = (val: string, label: string) => (
    <Link href={`/admin/inspecciones?status=${val}${q ? `&q=${q}` : ""}`}
      className={"btn btn-sm " + (status === val ? "btn-primary" : "btn-ghost")}>{label}</Link>
  );

  return (
    <>
      <div className="toolbar">
        {chip("all", "Todas")}{chip("authorized", "Autorizadas")}{chip("rejected", "No autorizadas")}
        {chip("closed", "Cerradas")}{chip("voided", "Anuladas")}
        <form style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <input className="input" name="q" defaultValue={q} placeholder="Placa…" style={{ minWidth: 160 }} />
          <button className="btn btn-ghost btn-sm">Buscar</button>
        </form>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Vehículo</th><th>Conductor</th><th>Resultado</th><th>Operación</th><th>Km</th><th>Fecha</th><th></th></tr></thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 700 }}>{r.vehicle_plate}<div className="cell-sub">v{r.checklist_version_number ?? "?"}</div></td>
                <td>{r.driver_name}</td>
                <td>
                  {r.status === "voided" ? <span className="badge neutral">Anulada</span>
                    : r.authorized === false ? <span className="badge bad">No autorizado</span>
                    : <span className={"badge " + (r.result === "bueno" ? "ok" : r.result === "regular" ? "warn" : "bad")}>{r.result ?? "—"}</span>}
                  {(r.bad_count > 0 || r.warn_count > 0) && r.status !== "voided" &&
                    <div className="cell-sub">{r.bad_count} malo · {r.warn_count} regular</div>}
                </td>
                <td>{r.operation_status === "open" ? <span className="badge warn">Abierta</span>
                  : r.operation_status === "closed" ? <span className="badge ok">Cerrada</span> : <span className="cell-sub">—</span>}</td>
                <td className="cell-sub">{fmtKm(r.km_inicial)}{r.km_final != null && <> → {fmtKm(r.km_final)}</>}</td>
                <td className="cell-sub">{fmtDateTime(r.submitted_at)}</td>
                <td><InspectionActions id={r.id} status={r.status} authorized={r.authorized} operation={r.operation_status} /></td>
              </tr>
            ))}
            {(data ?? []).length === 0 && <tr><td colSpan={7}><div className="stub"><p>No hay inspecciones con estos filtros.</p></div></td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <div className="cell-sub">{count ?? 0} inspección(es) · página {page} de {totalPages}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {page > 1 && <Link className="btn btn-ghost btn-sm" href={`/admin/inspecciones?status=${status}${q ? `&q=${q}` : ""}&page=${page - 1}`}>← Anterior</Link>}
          {page < totalPages && <Link className="btn btn-ghost btn-sm" href={`/admin/inspecciones?status=${status}${q ? `&q=${q}` : ""}&page=${page + 1}`}>Siguiente →</Link>}
        </div>
      </div>
    </>
  );
}
