import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fmtKm } from "@/lib/format";
import ExportButton from "./export-button";

export const dynamic = "force-dynamic";

export default async function ReportesPage({ searchParams }: { searchParams: { from?: string; to?: string; result?: string } }) {
  const supabase = createClient();
  const to = searchParams.to || new Date().toISOString().slice(0, 10);
  const from = searchParams.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const result = searchParams.result || "all";

  let query = supabase
    .from("inspections")
    .select("id,vehicle_plate,driver_name,result,authorized,status,km_inicial,km_final,recorrido,submitted_at,checklist_version_number")
    .neq("status", "in_progress")
    .gte("submitted_at", `${from}T00:00:00`).lte("submitted_at", `${to}T23:59:59`)
    .order("submitted_at", { ascending: false }).limit(1000);
  if (result !== "all") query = query.eq("result", result);
  const { data } = await query;
  const rows = data ?? [];

  const agg = {
    total: rows.length,
    authorized: rows.filter((r) => r.authorized === true).length,
    rejected: rows.filter((r) => r.authorized === false).length,
    bueno: rows.filter((r) => r.result === "bueno").length,
    regular: rows.filter((r) => r.result === "regular").length,
    malo: rows.filter((r) => r.result === "malo").length,
    km: rows.reduce((s, r) => s + (r.recorrido ?? 0), 0),
  };

  return (
    <>
      <div className="panel">
        <div className="panel-title">Filtros</div>
        <form className="toolbar" style={{ marginBottom: 0 }}>
          <label className="cell-sub">Desde <input className="input" type="date" name="from" defaultValue={from} /></label>
          <label className="cell-sub">Hasta <input className="input" type="date" name="to" defaultValue={to} /></label>
          <select className="select" name="result" defaultValue={result}>
            <option value="all">Todos los resultados</option>
            <option value="bueno">Bueno</option><option value="regular">Regular</option><option value="malo">Malo</option>
          </select>
          <button className="btn btn-primary btn-sm">Aplicar</button>
          <ExportButton rows={rows as any} />
        </form>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-val">{agg.total}</div><div className="kpi-lbl">Inspecciones</div></div>
        <div className="kpi-card"><div className="kpi-val" style={{ color: "var(--green)" }}>{agg.authorized}</div><div className="kpi-lbl">Autorizadas</div></div>
        <div className="kpi-card"><div className="kpi-val" style={{ color: "var(--red)" }}>{agg.rejected}</div><div className="kpi-lbl">No autorizadas</div></div>
        <div className="kpi-card"><div className="kpi-val">{fmtKm(agg.km)}</div><div className="kpi-lbl">Recorrido total</div></div>
      </div>
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))" }}>
        <div className="kpi-card"><div className="kpi-val" style={{ color: "var(--green)" }}>{agg.bueno}</div><div className="kpi-lbl">Bueno</div></div>
        <div className="kpi-card"><div className="kpi-val" style={{ color: "var(--orange)" }}>{agg.regular}</div><div className="kpi-lbl">Regular</div></div>
        <div className="kpi-card"><div className="kpi-val" style={{ color: "var(--red)" }}>{agg.malo}</div><div className="kpi-lbl">Malo</div></div>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Fecha</th><th>Vehículo</th><th>Conductor</th><th>Resultado</th><th>Autorizado</th><th>Recorrido</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="cell-sub">{fmtDateTime(r.submitted_at)}</td>
                <td style={{ fontWeight: 700 }}>{r.vehicle_plate}</td>
                <td>{r.driver_name}</td>
                <td><span className={"badge " + (r.result === "bueno" ? "ok" : r.result === "regular" ? "warn" : "bad")}>{r.result ?? "—"}</span></td>
                <td>{r.authorized ? "Sí" : "No"}</td>
                <td className="cell-sub">{r.recorrido != null ? fmtKm(r.recorrido) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6}><div className="stub"><p>Sin datos en el rango seleccionado.</p></div></td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length >= 1000 && <p className="cell-sub" style={{ marginTop: 10 }}>Mostrando las primeras 1000 filas. Acote el rango de fechas para ver el resto.</p>}
    </>
  );
}
