import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fmtTime } from "@/lib/format";
import NewRoundButton from "./new-round-button";

export const dynamic = "force-dynamic";

export default async function RondasPage() {
  const supabase = createClient();

  const [{ data: rounds }, { data: vehicles }] = await Promise.all([
    supabase.from("rounds").select("id,round_number,label,status,started_at,closed_at,responsible,notes")
      .order("round_number", { ascending: false }).limit(30),
    supabase.from("vehicle_status_view").select("plate,availability").neq("status", "archived"),
  ]);

  const open = (rounds ?? []).find((r) => r.status === "open") ?? null;
  const vlist = vehicles ?? [];
  const pending = vlist.filter((v) => v.availability === "available").map((v) => v.plate);
  const blocked = vlist.filter((v) => v.availability === "issues" || v.availability === "admin_blocked").map((v) => v.plate);

  const ids = (rounds ?? []).map((r) => r.id);
  let inspByRound: Record<string, { plate: string; time: string; ok: boolean }[]> = {};
  if (ids.length) {
    const { data: insp } = await supabase.from("inspections")
      .select("round_id,vehicle_plate,result,authorized,submitted_at,status")
      .in("round_id", ids).neq("status", "voided");
    (insp ?? []).forEach((i: any) => {
      (inspByRound[i.round_id] ??= []).push({
        plate: i.vehicle_plate, time: fmtTime(i.submitted_at),
        ok: i.authorized !== false && i.result === "bueno",
      });
    });
  }

  return (
    <>
      {pending.length ? (
        <div className="panel" style={{ borderColor: "#F0C4B9", background: "var(--red-soft)", marginBottom: 14 }}>
          <div className="panel-title" style={{ color: "var(--red)" }}>⚠ Sin inspeccionar en esta ronda ({pending.length})</div>
          <div className="panel-sub" style={{ marginTop: 6 }}>{pending.map((v) => <span key={v} className="plate-chip">{v}</span>)}</div>
        </div>
      ) : (
        <div className="panel" style={{ borderColor: "#B8E0C8", background: "var(--green-soft)", marginBottom: 14 }}>
          <div className="panel-title" style={{ color: "var(--green)" }}>✓ Todos los vehículos disponibles ya tienen inspección o están bloqueados</div>
        </div>
      )}

      {blocked.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-title">Vehículos bloqueados</div>
          <div className="panel-sub" style={{ margin: "8px 0" }}>No pueden operar hasta ser liberados (novedades o bloqueo administrativo).</div>
          <div>{blocked.map((v) => <span key={v} className="plate-chip" style={{ background: "var(--red-soft)", color: "var(--red)" }}>{v}</span>)}</div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Ronda vigente: {open?.label ?? "Ninguna"}</div>
            <div className="panel-sub">
              {open ? `Iniciada ${fmtDateTime(open.started_at)}${open.responsible ? ` · Responsable: ${open.responsible}` : ""}` : "Inicia una ronda para habilitar inspecciones."}
            </div>
          </div>
          <NewRoundButton hasOpen={!!open} />
        </div>
        {open?.notes ? <div className="cell-sub" style={{ marginBottom: 12 }}>{open.notes}</div> : null}

        <div className="manage-list">
          {(rounds ?? []).map((r) => {
            const items = inspByRound[r.id] ?? [];
            const okc = items.filter((i) => i.ok).length;
            return (
              <div key={r.id} className="manage-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <strong>{r.label}</strong>{" "}
                    {r.status === "open" ? <span className="badge ok">Abierta</span> : <span className="badge neutral">Cerrada</span>}
                    {r.responsible ? <span className="cell-sub"> · {r.responsible}</span> : null}
                  </div>
                  <div className="cell-sub">{items.length} inspección(es) · {okc} en buen estado · {items.length - okc} con novedades</div>
                </div>
                {items.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {items.map((i, k) => <span key={k} className="plate-chip">{i.plate} <span className="cell-sub">{i.time}</span></span>)}
                  </div>
                )}
              </div>
            );
          })}
          {(rounds ?? []).length === 0 && <div className="empty-state">Aún no hay rondas registradas.</div>}
        </div>
      </div>
    </>
  );
}
