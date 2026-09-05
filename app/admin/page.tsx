// Tablero: el resumen ejecutivo de la operación.
//
// QUÉ SE PIDE DE ESTA PANTALLA
// Que un administrador entienda el estado completo de la operación de un
// vistazo y sin navegar a ningún otro módulo. Eso significa tres cosas que
// antes no cumplía: que las cifras vengan acompañadas de qué hacer con ellas,
// que lo urgente se distinga de lo reciente, y que TODO lo que informa de un
// problema lleve al detalle de ese problema con un clic.
//
// Todo se lee con RLS (sólo la organización del usuario).
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtTime } from "@/lib/format";
import { motivoDe } from "@/lib/motivos";
import { horasDesde, nivelUrgencia, PESO_URGENCIA } from "@/lib/urgencia";
import NewRoundButton from "./rondas/new-round-button";
import { ChipsDeUnidades, ListaDeAlertas, type Alerta, type UnidadChip } from "./flota-interactiva";

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

  const [
    { data: vehicles }, { data: todayInsp }, { data: allOpenIssues },
    { data: recent }, { data: drivers }, { data: openOpsRows },
  ] = await Promise.all([
    supabase.from("vehicle_status_view")
      .select("id,plate,availability,admin_block_reason,blocked_at,open_issue_count")
      .neq("status", "archived").order("plate"),
    supabase.from("inspections")
      .select("id,vehicle_id,vehicle_plate,driver_id,driver_name,result,authorized,status,operation_status,released,auth_reasons,bad_count,warn_count,submitted_at")
      .gte("submitted_at", start).lte("submitted_at", end).neq("status", "in_progress").neq("status", "voided"),
    // Todas las abiertas, no sólo seis: hacen falta enteras para el reparto por
    // categoría y para poder ordenar las alertas por antigüedad real.
    supabase.from("issues")
      .select("id,vehicle_id,item_name,category_key,severity,status,description,created_at,vehicles(plate)")
      .neq("status", "resolved").order("created_at", { ascending: true }),
    supabase.from("inspections")
      .select("id,vehicle_plate,driver_name,result,authorized,status,operation_status,released,auth_reasons,submitted_at")
      .neq("status", "in_progress").order("created_at", { ascending: false }).limit(6),
    supabase.from("drivers").select("id,full_name").eq("active", true),
    // Operaciones abiertas de CUALQUIER día: un vehículo que salió ayer y no ha
    // vuelto sigue en ruta hoy, aunque su inspección no sea de hoy.
    supabase.from("inspections")
      .select("id,vehicle_id,vehicle_plate,driver_id,driver_name,submitted_at")
      .eq("operation_status", "open"),
  ]);

  const vlist = vehicles ?? [];
  const insp = todayInsp ?? [];
  const enRuta = openOpsRows ?? [];
  const abiertas = allOpenIssues ?? [];
  const total = insp.length;
  const authorized = insp.filter((i) => i.authorized === true).length;
  const rejected = insp.filter((i) => i.authorized === false).length;
  const okCount = insp.filter((i) => i.result === "bueno").length;
  const warnCount = insp.filter((i) => i.result === "regular").length;
  const badCount = insp.filter((i) => i.result === "malo").length;
  const openOps = enRuta.length;

  const available = vlist.filter((v) => v.availability === "available");
  const blocked = vlist.filter((v) => v.availability === "admin_blocked" || v.availability === "issues");
  const noAuth = insp.filter((i) => i.authorized === false);

  // --- Conductores: quién está fuera y quién puede salir --------------------
  // La regla la impone la base (una operación abierta por conductor, y el
  // vehículo ya inspeccionado queda tomado para la ronda). Aquí sólo se hace
  // visible, para que el administrador no tenga que deducir por qué el sistema
  // le está bloqueando a alguien.
  const totalConductores = (drivers ?? []).length;
  const idsEnOperacion = new Set(enRuta.map((o) => o.driver_id).filter(Boolean) as string[]);
  const enOperacion = idsEnOperacion.size;
  const yaOperaron = new Set(
    insp.filter((i) => i.driver_id && !idsEnOperacion.has(i.driver_id))
        .map((i) => i.driver_id as string)
  ).size;
  const disponibles = Math.max(0, totalConductores - enOperacion - yaOperaron);

  // --- Alertas priorizadas --------------------------------------------------
  // Dos fuentes con la misma pregunta detrás: ¿qué lleva más tiempo parado?
  const alertas: Alerta[] = [];
  abiertas.forEach((i: any) => {
    if (!i.vehicle_id) return;
    const h = horasDesde(i.created_at);
    const grave = i.severity === "bad";
    const nivel = nivelUrgencia(h, grave);
    if (nivel === "reciente") return;   // todavía no es noticia
    alertas.push({
      vehicleId: i.vehicle_id, plate: i.vehicles?.plate ?? "—",
      titulo: `${grave ? "Falla crítica" : "Novedad"} sin resolver: ${i.item_name}`,
      sub: `${i.category_key ?? "sin categoría"}${i.description ? ` · ${i.description}` : ""}`,
      nivel, horas: h,
    });
  });
  vlist.forEach((v: any) => {
    if (v.availability !== "admin_blocked" || !v.blocked_at) return;
    const h = horasDesde(v.blocked_at);
    const nivel = nivelUrgencia(h, true);
    if (nivel === "reciente") return;
    alertas.push({
      vehicleId: v.id, plate: v.plate,
      titulo: "Bloqueada por administración sin levantar",
      sub: v.admin_block_reason || "sin motivo registrado",
      nivel, horas: h,
    });
  });
  alertas.sort((a, b) => PESO_URGENCIA[b.nivel] - PESO_URGENCIA[a.nivel] || b.horas - a.horas);
  const alertasTop = alertas.slice(0, 6);

  // --- Fichas clicables -----------------------------------------------------
  const chipsBloqueados: UnidadChip[] = blocked.map((v: any) => ({
    id: v.id, plate: v.plate,
    tono: v.availability === "admin_blocked" ? "bad" : "warn",
    nota: v.availability === "admin_blocked"
      ? "bloqueo admin."
      : `${v.open_issue_count} novedad${v.open_issue_count === 1 ? "" : "es"}`,
  }));
  const chipsDisponibles: UnidadChip[] = available.map((v: any) => ({ id: v.id, plate: v.plate, tono: "ok" }));
  const chipsEnRuta: UnidadChip[] = enRuta.map((o: any) => ({
    id: o.vehicle_id, plate: o.vehicle_plate ?? "—",
    nota: (o.driver_name ?? "").split(" ")[0],
  }));
  const chipsNoAutorizados: UnidadChip[] = noAuth.map((i: any) => ({
    id: i.vehicle_id, plate: i.vehicle_plate, tono: "bad",
    nota: (i.driver_name ?? "").split(" ")[0],
  }));

  // Line chart: inspecciones por hora (activas hoy)
  const byHour: Record<number, number> = {};
  insp.forEach((i) => { if (i.submitted_at) { const h = bogotaHour(i.submitted_at); byHour[h] = (byHour[h] ?? 0) + 1; } });
  const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
  const hourLabels = hours.length ? hours.map((h) => String(h).padStart(2, "0")) : [];
  const hourValues = hours.map((h) => byHour[h]);

  // Donut: novedades por categoría (abiertas). Se calcula sobre las que ya se
  // trajeron para las alertas, en vez de repetir la consulta.
  const catCounts: Record<string, number> = {};
  abiertas.forEach((i) => { const k = i.category_key || "otros"; catCounts[k] = (catCounts[k] ?? 0) + 1; });
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
    { label: "Novedades abiertas", value: abiertas.length, tone: "orange", foot: alertasTop.length ? `${alertasTop.length} requieren atención` : "ninguna urgente", icon: '<path d="M12 9v4M12 17h.01M10.3 3.9 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>' },
    { label: "Operaciones en ruta", value: openOps, tone: "navy", foot: "sin registrar regreso", icon: '<path d="M21 12a9 9 0 1 1-3-6.7"/>' },
  ];

  const pctOperacion = totalConductores ? (enOperacion / totalConductores) * 100 : 0;
  const pctYaOperaron = totalConductores ? (yaOperaron / totalConductores) * 100 : 0;
  const pctDisponibles = totalConductores ? (disponibles / totalConductores) * 100 : 0;

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
          <div style={{ fontWeight: 700, color: "var(--red)", marginBottom: 8 }}>
            ⛔ {noAuth.length} unidad(es) NO AUTORIZADA(S) para salir hoy
          </div>
          <ChipsDeUnidades unidades={chipsNoAutorizados} vacio="" />
        </div>
      )}

      {/* Lo que lleva más tiempo esperando, arriba del todo. Un listado sin
          prioridad obliga a leerlo entero para saber por dónde empezar. */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title">Requiere atención</div>
            <div className="panel-sub">
              {alertasTop.length
                ? "Ordenado por lo que lleva más tiempo sin resolverse. Pulsa para ver la unidad."
                : "Sin pendientes que hayan superado su plazo."}
            </div>
          </div>
          {abiertas.length > 0 && <Link className="panel-link" href="/admin/novedades">Ver novedades →</Link>}
        </div>
        <ListaDeAlertas alertas={alertasTop} />
      </div>

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
          <div className="panel-head">
            <div>
              <div className="panel-title">Conductores</div>
              <div className="panel-sub">{totalConductores} activo(s) en la plantilla</div>
            </div>
            <Link className="panel-link" href="/admin/conductores">Ver todos →</Link>
          </div>
          {totalConductores ? (<>
            <div className="medidor" title="Reparto de la plantilla ahora mismo">
              <span className="medidor-parte" style={{ width: `${pctOperacion}%`, background: "var(--blue)" }} />
              <span className="medidor-parte" style={{ width: `${pctYaOperaron}%`, background: "var(--orange)" }} />
              <span className="medidor-parte" style={{ width: `${pctDisponibles}%`, background: "var(--green)" }} />
            </div>
            <div className="legend-row"><span className="legend-dot" style={{ background: "var(--blue)" }} /><span className="legend-name">En operación</span><span className="legend-val">{enOperacion}</span></div>
            <div className="legend-row"><span className="legend-dot" style={{ background: "var(--orange)" }} /><span className="legend-name">Ya operaron hoy</span><span className="legend-val">{yaOperaron}</span></div>
            <div className="legend-row"><span className="legend-dot" style={{ background: "var(--green)" }} /><span className="legend-name">Disponibles</span><span className="legend-val">{disponibles}</span></div>
            <div className="cell-sub" style={{ marginTop: 8 }}>
              Quien está en operación o ya cumplió su turno no puede iniciar otra
              inspección hasta registrar el regreso o hasta la ronda siguiente.
            </div>
          </>) : <div className="empty-state" style={{ padding: "30px 10px" }}>Sin conductores activos.</div>}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div><div className="panel-title">En ruta ahora</div>
              <div className="panel-sub">{enRuta.length} unidad(es) sin registrar regreso</div></div>
          </div>
          <ChipsDeUnidades unidades={chipsEnRuta} vacio="Ninguna unidad fuera en este momento." />
        </div>

        <div className="panel">
          <div className="panel-head">
            <div><div className="panel-title">Retenidas</div>
              <div className="panel-sub">{blocked.length} de {vlist.length} unidad(es) · pulsa para ver el motivo</div></div>
            <Link className="panel-link" href="/admin/vehiculos?f=bloqueados">Gestionar →</Link>
          </div>
          <ChipsDeUnidades unidades={chipsBloqueados} vacio="Ninguna unidad retenida." />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div><div className="panel-title">Disponibles para operar</div>
            <div className="panel-sub">{available.length} unidad(es) sin novedades ni bloqueos</div></div>
          <Link className="panel-link" href="/admin/vehiculos?f=disponibles">Ver flota →</Link>
        </div>
        <ChipsDeUnidades unidades={chipsDisponibles} vacio="Ninguna unidad disponible ahora mismo." />
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div><div className="panel-title">Inspecciones recientes</div>
              <div className="panel-sub">Últimos envíos, con el desenlace de cada uno</div></div>
            <Link className="panel-link" href="/admin/inspecciones">Ver todas →</Link>
          </div>
          {recent && recent.length ? (
            <table className="data-table">
              <thead><tr><th>Vehículo</th><th>Conductor</th><th>Hora</th><th>Desenlace</th></tr></thead>
              <tbody>
                {recent.map((r) => {
                  const m = motivoDe(r);
                  return (
                    <tr key={r.id}>
                      <td className="cell-veh">{r.vehicle_plate}</td>
                      <td>{r.driver_name}</td>
                      <td className="cell-sub">{fmtTime(r.submitted_at)}</td>
                      <td>
                        <span className={"badge " + m.tono}>{m.titulo}</span>
                        <div className="cell-sub">{m.detalle}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <div className="empty-state">Aún no se ha realizado ninguna inspección.</div>}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div><div className="panel-title">Novedades pendientes</div>
              <div className="panel-sub">Las más antiguas primero · pulsa para ver la unidad</div></div>
            <Link className="panel-link" href="/admin/novedades">Ver todas →</Link>
          </div>
          <ListaDeAlertas alertas={abiertas.slice(0, 6).map((i: any) => {
            const h = horasDesde(i.created_at);
            return {
              vehicleId: i.vehicle_id, plate: i.vehicles?.plate ?? "—",
              titulo: i.item_name,
              sub: `${i.severity === "bad" ? "Crítica" : "Leve"} · ${i.category_key ?? "sin categoría"}${i.description ? ` · ${i.description}` : ""}`,
              nivel: nivelUrgencia(h, i.severity === "bad"), horas: h,
            };
          })} />
        </div>
      </div>
    </>
  );
}
