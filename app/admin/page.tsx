import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtTime } from "@/lib/format";
import NewRoundButton from "./rondas/new-round-button";

export const dynamic = "force-dynamic";

const CAT_COLORS = ["#1568C0", "#C97A1A", "#1E8E5A", "#C6423C", "#6650C7", "#0EA5A5"];

function bogotaDayRange() {
  const now = new Date();
  const dayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return {
    start: new Date(`${dayStr}T00:00:00-05:00`).toISOString(),
    end: new Date(`${dayStr}T23:59:59-05:00`).toISOString(),
  };
}
function bogotaHour(iso: string) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", hour12: false }).format(new Date(iso)));
}

function Donut({ segments, size = 120 }: { segments: { value: number; color: string }[]; size?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 45, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" style={{ flexShrink: 0 }}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="#EDF2F8" strokeWidth="16" />
      {segments.map((s, i) => {
        const len = (s.value / total) * c;
        const el = (
          <circle key={i} cx="60" cy="60" r={r} fill="none" stroke={s.color} strokeWidth="16"
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
            transform="rotate(-90 60 60)" strokeLinecap="butt" />
        );
        offset += len;
        return el;
      })}
    </svg>
  );
}

function LineChart({ labels, values }: { labels: string[]; values: number[] }) {
  const W = 460, H = 180, padL = 28, padR = 10, padT = 14, padB = 26;
  const max = Math.max(...values, 1) + 1;
  const stepX = labels.length > 1 ? (W - padL - padR) / (labels.length - 1) : 0;
  const pts = values.map((v, i) => [padL + i * stepX, padT + (1 - v / max) * (H - padT - padB)]);
  const grid = [0, 1, 2, 3, 4].map((g) => padT + g * ((H - padT - padB) / 4));
  const line = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = pts.length ? line + ` L${pts[pts.length - 1][0]} ${H - padB} L${pts[0][0]} ${H - padB} Z` : "";
  return (
    <svg width="100%" height="180" viewBox="0 0 460 180" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1568C0" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1568C0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((y, i) => <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke="#EDF2F8" strokeWidth="1" />)}
      {area && <path d={area} fill="url(#lineFill)" />}
      {line && <path d={line} fill="none" stroke="#1568C0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.4" fill="#1568C0" stroke="#fff" strokeWidth="1.6" />)}
      {pts.map((p, i) => <text key={i} x={p[0]} y={H - 6} fontSize="9.5" fill="#6B7A90" textAnchor="middle">{labels[i]}h</text>)}
    </svg>
  );
}

function kpiIcon(d: string) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />;
}

export default async function DashboardPage() {
  const supabase = createClient();
  const { start, end } = bogotaDayRange();

  const { data: round } = await supabase.from("rounds")
    .select("id,label,round_number,responsible").eq("status", "open")
    .order("round_number", { ascending: false }).limit(1).maybeSingle();

  const [{ data: vehicles }, { data: todayInsp }, { data: openIssues }, { data: recent }] = await Promise.all([
    supabase.from("vehicle_status_view").select("plate,availability,admin_block_reason").neq("status", "archived").order("plate"),
    supabase.from("inspections")
      .select("id,vehicle_plate,driver_name,result,authorized,status,operation_status,bad_count,warn_count,submitted_at")
      .gte("submitted_at", start).lte("submitted_at", end).neq("status", "in_progress").neq("status", "voided"),
    supabase.from("issues")
      .select("id,item_name,category_key,severity,status,description,created_at,vehicles(plate)")
      .neq("status", "resolved").order("created_at", { ascending: false }).limit(6),
    supabase.from("inspections")
      .select("id,vehicle_plate,driver_name,result,authorized,status,submitted_at")
      .neq("status", "in_progress").order("created_at", { ascending: false }).limit(6),
  ]);

  const vlist = vehicles ?? [];
  const insp = todayInsp ?? [];
  const total = insp.length;
  const authorized = insp.filter((i) => i.authorized === true).length;
  const rejected = insp.filter((i) => i.authorized === false).length;
  const okCount = insp.filter((i) => i.result === "bueno").length;
  const warnCount = insp.filter((i) => i.result === "regular").length;
  const badCount = insp.filter((i) => i.result === "malo").length;
  const openOps = insp.filter((i) => i.operation_status === "open").length;

  const available = vlist.filter((v) => v.availability === "available");
  const blocked = vlist.filter((v) => v.availability === "admin_blocked" || v.availability === "issues");
  const pending = vlist.filter((v) => v.availability === "available");
  const noAuth = insp.filter((i) => i.authorized === false);

  // Line chart: inspecciones por hora (activas hoy)
  const byHour: Record<number, number> = {};
  insp.forEach((i) => { if (i.submitted_at) { const h = bogotaHour(i.submitted_at); byHour[h] = (byHour[h] ?? 0) + 1; } });
  const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
  const hourLabels = hours.length ? hours.map((h) => String(h).padStart(2, "0")) : [];
  const hourValues = hours.map((h) => byHour[h]);

  // Donut: novedades por categoría (abiertas)
  const { data: allOpenIssues } = await supabase.from("issues").select("category_key").neq("status", "resolved");
  const catCounts: Record<string, number> = {};
  (allOpenIssues ?? []).forEach((i) => { const k = i.category_key || "otros"; catCounts[k] = (catCounts[k] ?? 0) + 1; });
  const catSegments = Object.entries(catCounts).map(([k, v], i) => ({ label: k, value: v, color: CAT_COLORS[i % CAT_COLORS.length] }));
  const catTotal = catSegments.reduce((s, x) => s + x.value, 0) || 1;

  const fleetSegments = [
    { label: "Bueno", value: okCount, color: "#1E8E5A" },
    { label: "Regular", value: warnCount, color: "#C97A1A" },
    { label: "Malo", value: badCount, color: "#C6423C" },
  ].filter((s) => s.value > 0);

  const kpis = [
    { label: "Inspecciones hoy", value: total, tone: "blue", foot: `${round?.label ?? "sin ronda"}`, icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6"/>' },
    { label: "Autorizados", value: authorized, tone: "green", foot: "para salir", icon: '<path d="M20 6 9 17l-5-5"/>' },
    { label: "No autorizados", value: rejected, tone: "red", foot: "bloqueados", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>' },
    { label: "Novedades abiertas", value: allOpenIssues?.length ?? 0, tone: "orange", foot: "requieren atención", icon: '<path d="M12 9v4M12 17h.01M10.3 3.9 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>' },
    { label: "Operaciones en ruta", value: openOps, tone: "navy", foot: "sin registrar regreso", icon: '<path d="M21 12a9 9 0 1 1-3-6.7"/>' },
  ];

  return (
    <>
      <div className="round-card">
        <div>
          <div className="round-card-label">Ronda de inspección vigente</div>
          <div className="round-card-name">{round?.label ?? "Sin ronda abierta"}</div>
          <div className="cell-sub" style={{ marginTop: 4 }}>
            {round
              ? "Los vehículos ya inspeccionados en esta ronda quedan bloqueados para los demás conductores. Abre una ronda nueva para reiniciar el tablero."
              : "No hay una ronda abierta. Inicia una para habilitar inspecciones."}
            {round?.responsible ? ` · Responsable: ${round.responsible}` : ""}
          </div>
        </div>
        <NewRoundButton hasOpen={!!round} compact />
      </div>

      <div className="kpi-grid">
        {kpis.map((k, i) => (
          <div key={i} className={`kpi-card tone-${k.tone}`}>
            <div className="kpi-top">
              <span className="kpi-label">{k.label}</span>
              <span className="kpi-icon">{kpiIcon(k.icon)}</span>
            </div>
            <div className="kpi-num">{k.value}</div>
            <div className="kpi-foot">{k.foot}</div>
          </div>
        ))}
      </div>

      {noAuth.length > 0 && (
        <div className="panel" style={{ marginBottom: 14, borderColor: "#F0C4B9" }}>
          <div style={{ fontWeight: 700, color: "var(--red)", marginBottom: 6 }}>⛔ {noAuth.length} vehículo(s) NO AUTORIZADO(S) para salir</div>
          <div className="plate-chip-list">
            {noAuth.map((i) => <span key={i.id} className="plate-chip" style={{ background: "var(--red-soft)", color: "var(--red)" }}>{i.vehicle_plate} <span className="cell-sub">{i.driver_name}</span></span>)}
          </div>
        </div>
      )}

      <div className="grid-3">
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Actividad de hoy</div><div className="panel-sub">Inspecciones enviadas por hora</div></div></div>
          {hourValues.length ? <LineChart labels={hourLabels} values={hourValues} /> : <div className="empty-state" style={{ padding: "40px 10px" }}>Aún no se han enviado inspecciones hoy.</div>}
        </div>
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Novedades más frecuentes</div><div className="panel-sub">Por categoría, abiertas</div></div></div>
          {catSegments.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Donut segments={catSegments} />
              <div style={{ flex: 1 }}>
                {catSegments.map((n, i) => (
                  <div key={i} className="legend-row"><span className="legend-dot" style={{ background: n.color }} /><span className="legend-name" style={{ textTransform: "capitalize" }}>{n.label}</span><span className="legend-val">{Math.round((n.value / catTotal) * 100)}%</span></div>
                ))}
              </div>
            </div>
          ) : <div className="empty-state" style={{ padding: "40px 10px" }}>Sin novedades abiertas.</div>}
        </div>
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Estado de la flota revisada</div><div className="panel-sub">{total ? `${total} vehículo(s) revisados hoy` : "Aún no hay revisiones"}</div></div></div>
          {fleetSegments.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Donut segments={fleetSegments} />
              <div style={{ flex: 1 }}>
                {fleetSegments.map((n, i) => (
                  <div key={i} className="legend-row"><span className="legend-dot" style={{ background: n.color }} /><span className="legend-name">{n.label}</span><span className="legend-val">{n.value}</span></div>
                ))}
              </div>
            </div>
          ) : <div className="empty-state" style={{ padding: "40px 10px" }}>Sin vehículos revisados hoy.</div>}
        </div>
      </div>

      <div className="grid-3">
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Pendientes por revisar</div><div className="panel-sub">{pending.length} de {vlist.length} vehículo(s)</div></div></div>
          {pending.length ? <div className="plate-chip-list">{pending.map((v) => <span key={v.plate} className="plate-chip">{v.plate}</span>)}</div> : <div className="empty-state" style={{ padding: "30px 10px" }}>Todos revisados o en proceso.</div>}
        </div>
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Disponibles</div><div className="panel-sub">{available.length} vehículo(s) listos</div></div></div>
          {available.length ? <div className="plate-chip-list">{available.map((v) => <span key={v.plate} className="plate-chip" style={{ background: "var(--green-soft)", color: "var(--green)" }}>{v.plate}</span>)}</div> : <div className="empty-state" style={{ padding: "30px 10px" }}>Ninguno disponible ahora.</div>}
        </div>
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Bloqueados</div><div className="panel-sub">{blocked.length} vehículo(s)</div></div></div>
          {blocked.length ? <div className="manage-list">{blocked.map((v) => <div key={v.plate} className="manage-row manage-row-sm"><div className="manage-row-main"><span>{v.plate}</span></div><span className="cell-sub">{v.availability === "issues" ? "Novedades" : "Bloqueo admin."}</span></div>)}</div> : <div className="empty-state" style={{ padding: "30px 10px" }}>Ninguno bloqueado.</div>}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div><div className="panel-title">Inspecciones recientes</div><div className="panel-sub">Últimos envíos</div></div>
            <Link className="panel-link" href="/admin/inspecciones">Ver todas →</Link>
          </div>
          {recent && recent.length ? (
            <table className="data-table">
              <thead><tr><th>Vehículo</th><th>Conductor</th><th>Hora</th><th>Estado</th></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-veh">{r.vehicle_plate}</td>
                    <td>{r.driver_name}</td>
                    <td className="cell-sub">{fmtTime(r.submitted_at)}</td>
                    <td>{r.authorized === false ? <span className="badge bad">No autorizado</span> : <span className={"badge " + (r.result === "bueno" ? "ok" : r.result === "regular" ? "warn" : "bad")}>{r.result ?? "—"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty-state">Aún no se ha realizado ninguna inspección.</div>}
        </div>
        <div className="panel">
          <div className="panel-head">
            <div><div className="panel-title">Novedades pendientes</div><div className="panel-sub">Requieren seguimiento</div></div>
            <Link className="panel-link" href="/admin/novedades">Ver todas →</Link>
          </div>
          {openIssues && openIssues.length ? (
            <div className="issue-list">
              {openIssues.map((i: any) => (
                <div key={i.id} className="issue-row">
                  <span className={"issue-dot " + (i.severity === "bad" ? "bad" : "warn")} />
                  <div className="issue-main"><div className="issue-veh">{i.vehicles?.plate ?? "—"}</div><div className="issue-desc">{i.item_name}{i.description ? ` — ${i.description}` : ""}</div></div>
                  <span className={"badge " + (i.severity === "bad" ? "bad" : "warn")}>{i.severity === "bad" ? "Grave" : "Leve"}</span>
                </div>
              ))}
            </div>
          ) : <div className="empty-state">No hay novedades pendientes.</div>}
        </div>
      </div>
    </>
  );
}
