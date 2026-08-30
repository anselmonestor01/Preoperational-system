import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

async function count(q: any): Promise<number> {
  const { count } = await q;
  return count ?? 0;
}

export default async function DashboardPage() {
  const supabase = createClient();

  const { data: round } = await supabase
    .from("rounds").select("id,label,round_number,started_at")
    .eq("status", "open").order("round_number", { ascending: false }).limit(1).maybeSingle();

  const base = () => supabase.from("inspections").select("*", { count: "exact", head: true });

  const [
    vehActive, vehBlocked, driversActive, issuesOpen, opsOpen,
    inspRound, authRound, rejectRound, inspTotal,
  ] = await Promise.all([
    count(supabase.from("vehicles").select("*", { count: "exact", head: true }).eq("status", "active")),
    count(supabase.from("vehicles").select("*", { count: "exact", head: true }).eq("status", "active").eq("admin_blocked", true)),
    count(supabase.from("drivers").select("*", { count: "exact", head: true }).eq("active", true)),
    count(supabase.from("issues").select("*", { count: "exact", head: true }).neq("status", "resolved")),
    count(supabase.from("inspections").select("*", { count: "exact", head: true }).eq("operation_status", "open")),
    round ? count(base().eq("round_id", round.id).neq("status", "voided")) : Promise.resolve(0),
    round ? count(base().eq("round_id", round.id).eq("authorized", true)) : Promise.resolve(0),
    round ? count(base().eq("round_id", round.id).eq("authorized", false)) : Promise.resolve(0),
    count(base().neq("status", "voided")),
  ]);

  const { data: recent } = await supabase
    .from("inspections")
    .select("id,vehicle_plate,driver_name,result,authorized,status,submitted_at")
    .neq("status", "in_progress")
    .order("created_at", { ascending: false }).limit(7);

  const { data: openIssues } = await supabase
    .from("issues")
    .select("id,item_name,vehicle_id,severity,status,created_at,description")
    .neq("status", "resolved")
    .order("created_at", { ascending: false }).limit(7);

  const kpis = [
    { val: vehActive, lbl: "Vehículos activos", icon: "M2 7h13v10H2z" },
    { val: vehBlocked, lbl: "Vehículos bloqueados", icon: "M5 11h14v9H5z M8 11V8a4 4 0 018 0v3" },
    { val: inspRound, lbl: `Inspecciones · ${round?.label ?? "sin ronda"}`, icon: "M7 3h10v18H7z" },
    { val: opsOpen, lbl: "Operaciones abiertas", icon: "M21 12a9 9 0 11-3-6.7" },
    { val: issuesOpen, lbl: "Novedades abiertas", icon: "M12 9v4M12 17h.01" },
    { val: driversActive, lbl: "Conductores activos", icon: "M12 8a3 3 0 100-6 3 3 0 000 6z" },
  ];

  return (
    <>
      <div className="kpi-grid">
        {kpis.map((k, i) => (
          <div key={i} className="kpi-card">
            <div className="kpi-ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d={k.icon} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div className="kpi-val">{k.val}</div>
            <div className="kpi-lbl">{k.lbl}</div>
          </div>
        ))}
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))" }}>
        <div className="kpi-card"><div className="kpi-val" style={{ color: "var(--green)" }}>{authRound}</div><div className="kpi-lbl">Autorizadas (ronda)</div></div>
        <div className="kpi-card"><div className="kpi-val" style={{ color: "var(--red)" }}>{rejectRound}</div><div className="kpi-lbl">No autorizadas (ronda)</div></div>
        <div className="kpi-card"><div className="kpi-val">{inspTotal}</div><div className="kpi-lbl">Inspecciones (histórico)</div></div>
      </div>

      <div className="panel-grid">
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div className="panel-title">Inspecciones recientes</div></div>
            <Link href="/admin/inspecciones" className="btn btn-ghost btn-sm">Ver todas</Link>
          </div>
          {recent && recent.length ? (
            <div className="tbl-wrap" style={{ marginTop: 12 }}>
              <table className="tbl">
                <thead><tr><th>Vehículo</th><th>Conductor</th><th>Resultado</th><th>Fecha</th></tr></thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 700 }}>{r.vehicle_plate}</td>
                      <td>{r.driver_name}</td>
                      <td>{r.authorized === false
                        ? <span className="badge bad">No autorizado</span>
                        : <span className={"badge " + (r.result === "bueno" ? "ok" : r.result === "regular" ? "warn" : "bad")}>{r.result ?? "—"}</span>}</td>
                      <td className="cell-sub">{fmtDateTime(r.submitted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="stub"><p>Aún no hay inspecciones registradas.</p></div>}
        </div>

        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="panel-title">Novedades abiertas</div>
            <Link href="/admin/novedades" className="btn btn-ghost btn-sm">Ver todas</Link>
          </div>
          {openIssues && openIssues.length ? (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {openIssues.map((i) => (
                <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 12 }}>
                  <span className={"badge " + (i.severity === "bad" ? "bad" : "warn")}>{i.severity === "bad" ? "Grave" : "Leve"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{i.item_name}</div>
                    <div className="cell-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.description || "Sin detalle"}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="stub"><p>Sin novedades abiertas. 🎉</p></div>}
        </div>
      </div>
    </>
  );
}
