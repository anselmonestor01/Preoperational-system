import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import RoundsClient from "./rounds-client";

export const dynamic = "force-dynamic";

export default async function RondasPage() {
  const supabase = createClient();
  const { data: rounds } = await supabase
    .from("rounds").select("id,round_number,label,status,started_at,closed_at")
    .order("round_number", { ascending: false }).limit(50);
  const open = (rounds ?? []).find((r) => r.status === "open") ?? null;

  let inRound = 0;
  if (open) {
    const { count } = await supabase.from("inspections").select("*", { count: "exact", head: true })
      .eq("round_id", open.id).neq("status", "voided");
    inRound = count ?? 0;
  }

  return (
    <>
      <div className="panel">
        <div className="panel-title">Ronda vigente</div>
        {open ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display)" }}>{open.label}</div>
              <div className="cell-sub">Iniciada {fmtDateTime(open.started_at)} · {inRound} inspección(es)</div>
            </div>
            <RoundsClient hasOpen={true} />
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--orange)" }}>No hay ronda abierta</div>
              <div className="cell-sub" style={{ marginTop: 4 }}>
                El kiosco de conductores está bloqueado hasta que abra una ronda nueva.
              </div>
            </div>
            <RoundsClient hasOpen={false} />
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">Historial de rondas</div>
        <div className="tbl-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead><tr><th>#</th><th>Ronda</th><th>Estado</th><th>Inicio</th><th>Cierre</th></tr></thead>
            <tbody>
              {(rounds ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.round_number}</td><td style={{ fontWeight: 600 }}>{r.label}</td>
                  <td>{r.status === "open" ? <span className="badge ok">Abierta</span> : <span className="badge neutral">Cerrada</span>}</td>
                  <td className="cell-sub">{fmtDateTime(r.started_at)}</td>
                  <td className="cell-sub">{r.closed_at ? fmtDateTime(r.closed_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
