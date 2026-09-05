// Reportes: filtra por ronda, fecha, vehículo, conductor y resultado; resume
// indicadores y reúne la evidencia fotográfica del periodo.
//
// A ESCALA
// Con cientos de inspecciones al año, una tabla de detalle plana responde mal a
// las preguntas que de verdad se hacen: «¿cómo se ha portado ESTA unidad?»,
// «¿qué historial tiene ESTE conductor?». Por eso hay tres lecturas del mismo
// conjunto filtrado: el detalle de siempre, un resumen por vehículo y otro por
// conductor. Los filtros son los mismos para las tres y se combinan entre sí.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fmtKm } from "@/lib/format";
import { motivoDe } from "@/lib/motivos";
import EvidenceGallery from "@/components/EvidenceGallery";
import ExportButton from "./export-button";

export const dynamic = "force-dynamic";

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: {
    round?: string; from?: string; to?: string; vehicle?: string;
    driver?: string; result?: string; vista?: string;
  };
}) {
  const supabase = createClient();
  const to = searchParams.to || new Date().toISOString().slice(0, 10);
  const from = searchParams.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const result = searchParams.result || "all";
  const roundId = searchParams.round || "all";
  const vehicle = searchParams.vehicle || "all";
  const driver = searchParams.driver || "all";
  const vista = ["vehiculos", "conductores"].includes(searchParams.vista ?? "")
    ? (searchParams.vista as "vehiculos" | "conductores") : "detalle";

  const [{ data: rounds }, { data: vehicles }, { data: drivers }] = await Promise.all([
    supabase.from("rounds").select("id,label,round_number,responsible,started_at,status").order("round_number", { ascending: false }).limit(200),
    supabase.from("vehicles").select("id,plate").order("plate"),
    supabase.from("drivers").select("id,full_name").order("full_name"),
  ]);

  let query = supabase.from("inspections")
    .select("id,vehicle_plate,driver_name,vehicle_id,driver_id,round_id,result,authorized,status,operation_status,released,auth_reasons,void_reason,km_inicial,km_final,recorrido,submitted_at,device_label,device_id")
    .neq("status", "in_progress").order("submitted_at", { ascending: false }).limit(1000);
  if (roundId !== "all") query = query.eq("round_id", roundId);
  else query = query.gte("submitted_at", `${from}T00:00:00`).lte("submitted_at", `${to}T23:59:59`);
  if (result !== "all") query = query.eq("result", result);
  if (vehicle !== "all") query = query.eq("vehicle_id", vehicle);
  if (driver !== "all") query = query.eq("driver_id", driver);
  const { data } = await query;
  const rows = (data ?? []).filter((r) => r.status !== "voided");

  // --- Novedades del periodo, para poder explicar cada desenlace y para el
  //     historial de averías por vehículo. -----------------------------------
  const conteoNov: Record<string, { abiertas: number; totales: number }> = {};
  const novPorVehiculo: Record<string, { abiertas: number; totales: number }> = {};
  if (rows.length) {
    // Se pide por lotes. Un `in(...)` con mil identificadores viaja en la URL y
    // a esa escala la revienta: el filtro se trocea para que el reporte siga
    // funcionando igual con diez inspecciones que con mil.
    const LOTE = 200;
    const novs: any[] = [];
    for (let i = 0; i < rows.length; i += LOTE) {
      const { data } = await supabase.from("issues")
        .select("inspection_id,vehicle_id,status")
        .in("inspection_id", rows.slice(i, i + LOTE).map((r) => r.id));
      if (data) novs.push(...data);
    }
    (novs ?? []).forEach((n: any) => {
      if (n.inspection_id) {
        const c = (conteoNov[n.inspection_id] ??= { abiertas: 0, totales: 0 });
        c.totales++; if (n.status !== "resolved") c.abiertas++;
      }
      if (n.vehicle_id) {
        const c = (novPorVehiculo[n.vehicle_id] ??= { abiertas: 0, totales: 0 });
        c.totales++; if (n.status !== "resolved") c.abiertas++;
      }
    });
  }

  // --- Resúmenes -----------------------------------------------------------
  // La misma pregunta desde los dos lados de la operación: qué ha hecho cada
  // unidad y qué ha hecho cada persona, sobre el conjunto ya filtrado.
  const etiquetaRonda: Record<string, string> = {};
  (rounds ?? []).forEach((r) => { etiquetaRonda[r.id] = r.label; });

  type Resumen = {
    id: string; nombre: string; total: number; autorizadas: number; rechazadas: number;
    km: number; rondas: Set<string>; ultima: string | null;
    abiertas: number; novedades: number;
  };
  function agrupar(clave: "vehicle_id" | "driver_id", nombreDe: (r: any) => string): Resumen[] {
    const m: Record<string, Resumen> = {};
    rows.forEach((r: any) => {
      const k = r[clave]; if (!k) return;
      const g = (m[k] ??= {
        id: k, nombre: nombreDe(r), total: 0, autorizadas: 0, rechazadas: 0,
        km: 0, rondas: new Set<string>(), ultima: null, abiertas: 0, novedades: 0,
      });
      g.total++;
      if (r.authorized === true) g.autorizadas++;
      if (r.authorized === false) g.rechazadas++;
      g.km += r.recorrido ?? 0;
      if (r.round_id) g.rondas.add(r.round_id);
      if (!g.ultima || (r.submitted_at && r.submitted_at > g.ultima)) g.ultima = r.submitted_at;
      const c = conteoNov[r.id]; if (c) { g.novedades += c.totales; g.abiertas += c.abiertas; }
    });
    return Object.values(m).sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
  }
  const porVehiculo = vista === "vehiculos" ? agrupar("vehicle_id", (r) => r.vehicle_plate ?? "—") : [];
  const porConductor = vista === "conductores" ? agrupar("driver_id", (r) => r.driver_name ?? "—") : [];

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
    const ids = rows.slice(0, 200).map((r) => r.id);
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

  // La exportación sigue a la pestaña: si estás mirando el resumen por
  // conductor, lo que quieres bajarte es ese resumen, no la tabla de detalle.
  const csvDetalle = rows.map((r) => {
    const c = conteoNov[r.id] ?? { abiertas: 0, totales: 0 };
    return {
      fecha: fmtDateTime(r.submitted_at), ronda: etiquetaRonda[r.round_id ?? ""] ?? "",
      vehiculo: r.vehicle_plate, conductor: r.driver_name,
      resultado: r.result ?? "", autorizado: r.authorized ? "Si" : "No",
      desenlace: motivoDe({ ...r, novedades_abiertas: c.abiertas, novedades_total: c.totales }).texto,
      km_inicial: r.km_inicial ?? "", km_final: r.km_final ?? "", recorrido: r.recorrido ?? "",
    };
  });
  const csvResumen = (g: typeof porVehiculo) => g.map((x) => ({
    nombre: x.nombre, inspecciones: x.total, autorizadas: x.autorizadas, no_autorizadas: x.rechazadas,
    rondas: x.rondas.size, recorrido_km: x.km,
    novedades: x.novedades, novedades_abiertas: x.abiertas,
    ultima_operacion: fmtDateTime(x.ultima),
  }));
  const csvRows = vista === "vehiculos" ? csvResumen(porVehiculo)
    : vista === "conductores" ? csvResumen(porConductor)
    : csvDetalle;

  const enlaceVista = (v: string) => {
    const p = new URLSearchParams();
    if (roundId !== "all") p.set("round", roundId); else { p.set("from", from); p.set("to", to); }
    if (vehicle !== "all") p.set("vehicle", vehicle);
    if (driver !== "all") p.set("driver", driver);
    if (result !== "all") p.set("result", result);
    if (v !== "detalle") p.set("vista", v);
    const q = p.toString();
    return "/admin/reportes" + (q ? `?${q}` : "");
  };

  /** Tabla de resumen, idéntica para vehículos y conductores. */
  const TablaResumen = ({ g, titulo, enlace }: {
    g: typeof porVehiculo; titulo: string; enlace: (id: string) => string;
  }) => (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead><tr>
          <th>{titulo}</th><th>Operaciones</th><th>Rondas</th>
          <th>Autorizadas</th><th>No autorizadas</th><th>Recorrido</th>
          <th>Novedades</th><th>Última</th><th></th>
        </tr></thead>
        <tbody>
          {g.map((x) => (
            <tr key={x.id}>
              <td className="cell-veh">{x.nombre}</td>
              <td><b>{x.total}</b></td>
              <td className="cell-sub">{x.rondas.size}</td>
              <td><span className="badge ok">{x.autorizadas}</span></td>
              <td>{x.rechazadas ? <span className="badge bad">{x.rechazadas}</span> : <span className="cell-sub">—</span>}</td>
              <td className="cell-sub">{fmtKm(x.km)}</td>
              <td>
                {x.novedades
                  ? <>{x.novedades} en total{x.abiertas ? <div className="cell-sub" style={{ color: "var(--red)" }}>{x.abiertas} sin resolver</div> : null}</>
                  : <span className="cell-sub">ninguna</span>}
              </td>
              <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(x.ultima)}</td>
              <td><Link className="btn btn-ghost btn-sm" href={enlace(x.id)}>Ver detalle</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="panel">
        <div className="panel-head"><div><div className="panel-title">Reportes</div><div className="panel-sub">Filtra por ronda, fecha, vehículo, conductor o resultado</div></div>
          <ExportButton rows={csvRows}
            nombre={vista === "vehiculos" ? "resumen-por-vehiculo"
              : vista === "conductores" ? "resumen-por-conductor"
              : "inspecciones-detalle"} /></div>
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

      <div className="pestanas">
        <Link href={enlaceVista("detalle")} className={"pestana " + (vista === "detalle" ? "activa" : "")}>
          Detalle de inspecciones
        </Link>
        <Link href={enlaceVista("vehiculos")} className={"pestana " + (vista === "vehiculos" ? "activa" : "")}>
          Resumen por vehículo
        </Link>
        <Link href={enlaceVista("conductores")} className={"pestana " + (vista === "conductores" ? "activa" : "")}>
          Resumen por conductor
        </Link>
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

      {vista === "detalle" && (
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Detalle de inspecciones</div>
            <div className="panel-sub">{rows.length} inspección(es) con los filtros aplicados</div></div></div>
          {rows.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead><tr><th>Fecha</th><th>Ronda</th><th>Vehículo</th><th>Conductor</th><th>Recorrido</th><th>Desenlace</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const c = conteoNov[r.id] ?? { abiertas: 0, totales: 0 };
                    const m = motivoDe({ ...r, novedades_abiertas: c.abiertas, novedades_total: c.totales });
                    return (
                      <tr key={r.id}>
                        <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.submitted_at)}</td>
                        <td className="cell-sub">{etiquetaRonda[r.round_id ?? ""] ?? "—"}</td>
                        <td className="cell-veh">{r.vehicle_plate}</td>
                        <td>{r.driver_name}</td>
                        <td className="cell-sub">{r.recorrido != null ? fmtKm(r.recorrido) : "—"}</td>
                        <td style={{ minWidth: 200 }}>
                          <span className={"badge " + m.tono}>{m.titulo}</span>
                          <div className="cell-sub">{m.detalle}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-state">Sin datos para los filtros seleccionados.</div>}
        </div>
      )}

      {vista === "vehiculos" && (
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Resumen por vehículo</div>
            <div className="panel-sub">{porVehiculo.length} unidad(es) con actividad en el periodo filtrado</div></div></div>
          {porVehiculo.length
            ? <TablaResumen g={porVehiculo} titulo="Vehículo"
                enlace={(id) => enlaceVista("detalle") + (enlaceVista("detalle").includes("?") ? "&" : "?") + `vehicle=${id}`} />
            : <div className="empty-state">Ninguna unidad operó con estos filtros.</div>}
        </div>
      )}

      {vista === "conductores" && (
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Resumen por conductor</div>
            <div className="panel-sub">{porConductor.length} conductor(es) con actividad en el periodo filtrado</div></div></div>
          {porConductor.length
            ? <TablaResumen g={porConductor} titulo="Conductor"
                enlace={(id) => enlaceVista("detalle") + (enlaceVista("detalle").includes("?") ? "&" : "?") + `driver=${id}`} />
            : <div className="empty-state">Ningún conductor operó con estos filtros.</div>}
        </div>
      )}

      {vista === "detalle" && (
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
      )}
    </>
  );
}
