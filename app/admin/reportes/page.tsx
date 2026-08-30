import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fmtKm } from "@/lib/format";
import EvidenceGallery from "@/components/EvidenceGallery";
import ExportButton from "./export-button";

export const dynamic = "force-dynamic";

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: { round?: string; from?: string; to?: string; vehicle?: string; driver?: string; result?: string };
}) {
  const supabase = createClient();
  const to = searchParams.to || new Date().toISOString().slice(0, 10);
  const from = searchParams.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const result = searchParams.result || "all";
  const roundId = searchParams.round || "all";
  const vehicle = searchParams.vehicle || "all";
  const driver = searchParams.driver || "all";

  const [{ data: rounds }, { data: vehicles }, { data: drivers }] = await Promise.all([
    supabase.from("rounds").select("id,label,round_number,responsible,started_at,status").order("round_number", { ascending: false }).limit(50),
    supabase.from("vehicles").select("id,plate").order("plate"),
    supabase.from("drivers").select("id,full_name").order("full_name"),
  ]);

  let query = supabase.from("inspections")
    .select("id,vehicle_plate,driver_name,vehicle_id,driver_id,round_id,result,authorized,status,km_inicial,km_final,recorrido,submitted_at")
    .neq("status", "in_progress").order("submitted_at", { ascending: false }).limit(1000);
  if (roundId !== "all") query = query.eq("round_id", roundId);
  else query = query.gte("submitted_at", `${from}T00:00:00`).lte("submitted_at", `${to}T23:59:59`);
  if (result !== "all") query = query.eq("result", result);
  if (vehicle !== "all") query = query.eq("vehicle_id", vehicle);
  if (driver !== "all") query = query.eq("driver_id", driver);
  const { data } = await query;
  const rows = (data ?? []).filter((r) => r.status !== "voided");

  const agg = {
    total: rows.length,
    authorized: rows.filter((r) => r.authorized === true).length,
    rejected: rows.filter((r) => r.authorized === false).length,
    bueno: rows.filter((r) => r.result === "bueno").length,
    regular: rows.filter((r) => r.result === "regular").length,
    malo: rows.filter((r) => r.result === "malo").length,
    km: rows.reduce((s, r) => s + (r.recorrido ?? 0), 0),
  };

  // Evidencia fotográfica de las inspecciones filtradas.
  const photoCards: { url: string; label: string; sub: string }[] = [];
  if (rows.length) {
    const ids = rows.slice(0, 300).map((r) => r.id);
    const { data: evs } = await supabase.from("issue_evidence").select("storage_path,inspection_id").in("inspection_id", ids);
    const paths = (evs ?? []).map((e) => e.storage_path);
    if (paths.length) {
      const { data: signed } = await supabase.storage.from("evidence").createSignedUrls(paths, 3600);
      const map: Record<string, string> = {};
      (signed ?? []).forEach((s) => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl; });
      const inspById: Record<string, any> = {}; rows.forEach((r) => (inspById[r.id] = r));
      (evs ?? []).forEach((e) => {
        if (map[e.storage_path]) {
          const r = inspById[e.inspection_id];
          photoCards.push({ url: map[e.storage_path], label: r?.vehicle_plate ?? "—", sub: `${r?.driver_name ?? ""} · ${fmtDateTime(r?.submitted_at)}` });
        }
      });
    }
  }

  const selRound = (rounds ?? []).find((r) => r.id === roundId) || null;

  const csvRows = rows.map((r) => ({
    fecha: fmtDateTime(r.submitted_at), vehiculo: r.vehicle_plate, conductor: r.driver_name,
    resultado: r.result ?? "", autorizado: r.authorized ? "Si" : "No",
    km_inicial: r.km_inicial ?? "", km_final: r.km_final ?? "", recorrido: r.recorrido ?? "",
  }));

  return (
    <>
      <div className="panel">
        <div className="panel-head"><div><div className="panel-title">Reportes</div><div className="panel-sub">Filtra por ronda, fecha, vehículo, conductor o resultado</div></div>
          <ExportButton rows={csvRows} /></div>
        <form className="toolbar" style={{ marginBottom: 0, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="cell-sub">Ronda<br />
            <select className="select manage-input" name="round" defaultValue={roundId} style={{ minWidth: 180 }}>
              <option value="all">Todas (por fecha)</option>
              {(rounds ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="cell-sub">Desde<br /><input className="manage-input" type="date" name="from" defaultValue={from} /></label>
          <label className="cell-sub">Hasta<br /><input className="manage-input" type="date" name="to" defaultValue={to} /></label>
          <label className="cell-sub">Vehículo<br />
            <select className="select manage-input" name="vehicle" defaultValue={vehicle}>
              <option value="all">Todos</option>
              {(vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
            </select>
          </label>
          <label className="cell-sub">Conductor<br />
            <select className="select manage-input" name="driver" defaultValue={driver}>
              <option value="all">Todos</option>
              {(drivers ?? []).map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </label>
          <label className="cell-sub">Resultado<br />
            <select className="select manage-input" name="result" defaultValue={result}>
              <option value="all">Todos</option><option value="bueno">Bueno</option><option value="regular">Regular</option><option value="malo">Malo</option>
            </select>
          </label>
          <button className="btn btn-primary btn-sm">Aplicar filtros</button>
        </form>
      </div>

      {selRound && (
        <div className="round-card" style={{ marginTop: 0 }}>
          <div>
            <div className="round-card-label">Reporte de ronda</div>
            <div className="round-card-name">{selRound.label}</div>
            <div className="cell-sub" style={{ marginTop: 4 }}>
              {fmtDateTime(selRound.started_at)}{selRound.responsible ? ` · Responsable: ${selRound.responsible}` : ""} · {agg.total} inspección(es) · {agg.authorized} autorizadas · {agg.rejected} no autorizadas · {fmtKm(agg.km)}
            </div>
          </div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))" }}>
        <div className="kpi-card tone-blue"><div className="kpi-top"><span className="kpi-label">Inspecciones</span></div><div className="kpi-num">{agg.total}</div></div>
        <div className="kpi-card tone-green"><div className="kpi-top"><span className="kpi-label">Autorizadas</span></div><div className="kpi-num">{agg.authorized}</div></div>
        <div className="kpi-card tone-red"><div className="kpi-top"><span className="kpi-label">No autorizadas</span></div><div className="kpi-num">{agg.rejected}</div></div>
        <div className="kpi-card tone-orange"><div className="kpi-top"><span className="kpi-label">Con novedades</span></div><div className="kpi-num">{agg.regular + agg.malo}</div></div>
        <div className="kpi-card tone-navy"><div className="kpi-top"><span className="kpi-label">Recorrido</span></div><div className="kpi-num" style={{ fontSize: 22 }}>{fmtKm(agg.km)}</div></div>
      </div>

      <div className="panel">
        <div className="panel-head"><div><div className="panel-title">Detalle</div><div className="panel-sub">{rows.length} inspección(es)</div></div></div>
        {rows.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Fecha</th><th>Vehículo</th><th>Conductor</th><th>Resultado</th><th>Autorizado</th><th>Recorrido</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.submitted_at)}</td>
                    <td className="cell-veh">{r.vehicle_plate}</td>
                    <td>{r.driver_name}</td>
                    <td><span className={"badge " + (r.result === "bueno" ? "ok" : r.result === "regular" ? "warn" : "bad")}>{r.result ?? "—"}</span></td>
                    <td>{r.authorized ? "Sí" : "No"}</td>
                    <td className="cell-sub">{r.recorrido != null ? fmtKm(r.recorrido) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-state">Sin datos para los filtros seleccionados.</div>}
      </div>

      <div className="panel">
        <div className="panel-head"><div><div className="panel-title">Evidencia fotográfica</div><div className="panel-sub">{photoCards.length} foto(s) — clic para ampliar</div></div></div>
        {photoCards.length ? (
          <div className="report-photo-grid">
            {photoCards.map((p, i) => (
              <div key={i} className="report-photo-card">
                <EvidenceGallery urls={[p.url]} size={140} />
                <div className="report-photo-meta"><div className="issue-veh" style={{ fontSize: 12.5 }}>{p.label}</div><div className="cell-sub">{p.sub}</div></div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state">Ninguna inspección filtrada incluye evidencia fotográfica.</div>}
      </div>
    </>
  );
}
