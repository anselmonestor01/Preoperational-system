import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

async function count(q: any): Promise<number> {
  const { count } = await q;
  return count ?? 0;
}

const ICONS = {
  inspect: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  ok: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  warn: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 9v4M12 17h.01M10.3 3.9L2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  bad: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  pending: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ops: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="7" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M15 10h3.3a1 1 0 0 1 .85.47L21 14v3h-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  truck: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="7" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M15 10h3.3a1 1 0 0 1 .85.47L21 14v3h-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

export default async function DashboardPage() {
  const supabase = createClient();

  const { data: round } = await supabase
    .from("rounds")
    .select("id,label,round_number,started_at,status")
    .eq("status", "open")
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const base = () => supabase.from("inspections").select("*", { count: "exact", head: true });

  const [
    vehActive,
    vehBlocked,
    driversActive,
    issuesOpen,
    opsOpen,
    inspRound,
    authRound,
    rejectRound,
    inspTotal,
  ] = await Promise.all([
    count(supabase.from("vehicles").select("*", { count: "exact", head: true }).eq("status", "active")),
    count(
      supabase
        .from("vehicles")
        .select("*", { count: "exact", head: true })
        .eq("status", "active")
        .eq("admin_blocked", true),
    ),
    count(supabase.from("drivers").select("*", { count: "exact", head: true }).eq("active", true)),
    count(supabase.from("issues").select("*", { count: "exact", head: true }).neq("status", "resolved")),
    count(
      supabase.from("inspections").select("*", { count: "exact", head: true }).eq("operation_status", "open"),
    ),
    round ? count(base().eq("round_id", round.id).neq("status", "voided")) : Promise.resolve(0),
    round ? count(base().eq("round_id", round.id).eq("authorized", true)) : Promise.resolve(0),
    round ? count(base().eq("round_id", round.id).eq("authorized", false)) : Promise.resolve(0),
    count(base().neq("status", "voided")),
  ]);

  const pendingVehicles = Math.max(vehActive - inspRound, 0);

  const { data: recent } = await supabase
    .from("inspections")
    .select("id,vehicle_plate,driver_name,result,authorized,status,submitted_at")
    .neq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(6);

  const { data: openIssues } = await supabase
    .from("issues")
    .select("id,item_name,vehicle_id,severity,status,created_at,description,vehicles(plate)")
    .neq("status", "resolved")
    .order("created_at", { ascending: false })
    .limit(6);

  const kpis: {
    label: string;
    value: number | string;
    foot: string;
    tone: "blue" | "green" | "orange" | "red" | "navy";
    icon: React.ReactNode;
  }[] = [
    {
      label: "Inspecciones (ronda)",
      value: inspRound,
      foot: round ? round.label : "Sin ronda abierta",
      tone: "blue",
      icon: ICONS.inspect,
    },
    {
      label: "Autorizadas",
      value: authRound,
      foot: inspRound ? `${Math.round((authRound / Math.max(inspRound, 1)) * 100)}% del total` : "—",
      tone: "green",
      icon: ICONS.ok,
    },
    {
      label: "No autorizadas",
      value: rejectRound,
      foot: inspRound ? `${Math.round((rejectRound / Math.max(inspRound, 1)) * 100)}% del total` : "—",
      tone: "red",
      icon: ICONS.bad,
    },
    {
      label: "Pendientes de ronda",
      value: pendingVehicles,
      foot: `De ${vehActive} vehículos activos`,
      tone: "navy",
      icon: ICONS.pending,
    },
    {
      label: "Operaciones abiertas",
      value: opsOpen,
      foot: "Sin registrar regreso",
      tone: "orange",
      icon: ICONS.ops,
    },
    {
      label: "Novedades abiertas",
      value: issuesOpen,
      foot: "Requieren seguimiento",
      tone: "orange",
      icon: ICONS.warn,
    },
  ];

  return (
    <>
      <div className="round-card">
        <div>
          <div className="round-card-label">Ronda de inspección vigente</div>
          <div className="round-card-name">{round?.label ?? "Sin ronda abierta"}</div>
          <div className="cell-sub">
            Los vehículos ya inspeccionados en esta ronda quedan bloqueados para los demás conductores.
            Abre una ronda nueva para reiniciar el tablero (cambio de turno, reasignación) sin esperar a mañana.
          </div>
        </div>
        <Link href="/admin/rondas" className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}>
          Gestionar rondas
        </Link>
      </div>

      <div className="kpi-grid">
        {kpis.map((k) => (
          <div key={k.label} className={`kpi-card tone-${k.tone}`}>
            <div className="kpi-top">
              <span className="kpi-label">{k.label}</span>
              <span className="kpi-icon">{k.icon}</span>
            </div>
            <div className="kpi-num">{k.value}</div>
            <div className="kpi-foot">{k.foot}</div>
          </div>
        ))}
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
        <div className="kpi-card tone-navy">
          <div className="kpi-top">
            <span className="kpi-label">Vehículos activos</span>
          </div>
          <div className="kpi-num">{vehActive}</div>
          <div className="kpi-foot">{vehBlocked} bloqueado(s)</div>
        </div>
        <div className="kpi-card tone-blue">
          <div className="kpi-top">
            <span className="kpi-label">Conductores activos</span>
          </div>
          <div className="kpi-num">{driversActive}</div>
          <div className="kpi-foot">Habilitados para kiosco</div>
        </div>
        <div className="kpi-card tone-green">
          <div className="kpi-top">
            <span className="kpi-label">Inspecciones (histórico)</span>
          </div>
          <div className="kpi-num">{inspTotal}</div>
          <div className="kpi-foot">Total no anuladas</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Inspecciones recientes</div>
              <div className="panel-sub">Últimas enviadas</div>
            </div>
            <Link href="/admin/inspecciones" className="panel-link">
              Ver todas →
            </Link>
          </div>
          {recent && recent.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vehículo</th>
                  <th>Conductor</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-veh">
                      {ICONS.truck}
                      {r.vehicle_plate}
                    </td>
                    <td>{r.driver_name}</td>
                    <td className="cell-sub">{fmtDateTime(r.submitted_at)}</td>
                    <td>
                      {r.authorized === false ? (
                        <span className="badge bad">No autorizado</span>
                      ) : (
                        <span
                          className={
                            "badge " +
                            (r.result === "bueno" ? "ok" : r.result === "regular" ? "warn" : "bad")
                          }
                        >
                          {r.result ?? "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">Aún no se ha realizado ninguna inspección.</div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Novedades pendientes</div>
              <div className="panel-sub">Requieren seguimiento</div>
            </div>
            <Link href="/admin/novedades" className="panel-link">
              Ver todas →
            </Link>
          </div>
          {openIssues && openIssues.length ? (
            <div className="issue-list">
              {openIssues.map((i: any) => {
                const plate = i.vehicles?.plate ?? "—";
                return (
                  <div key={i.id} className="issue-row">
                    <span
                      className={"issue-dot " + (i.severity === "bad" ? "pending" : "review")}
                    />
                    <div className="issue-main">
                      <div className="issue-veh">{plate}</div>
                      <div className="issue-desc">
                        {i.item_name}
                        {i.description ? ` · ${i.description}` : ""}
                      </div>
                    </div>
                    <span className={"badge " + (i.severity === "bad" ? "bad" : "warn")}>
                      {i.severity === "bad" ? "Grave" : "Leve"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">No hay novedades pendientes.</div>
          )}
        </div>
      </div>
    </>
  );
}
