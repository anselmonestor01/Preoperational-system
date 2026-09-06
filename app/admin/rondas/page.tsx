// Rondas: ronda vigente, cobertura de la flota y vehículos aún sin inspeccionar.
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fmtTime } from "@/lib/format";
import NewRoundButton from "./new-round-button";
import RoundActions from "./round-actions";

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
          <details className="pliegue">
            <summary>Ver las {pending.length} unidades</summary>
            <div className="rejilla-placas">{pending.map((v) => (
              <span key={v} className="placa-casilla sin"><span className="p">{v}</span></span>))}</div>
          </details>
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
          <details className="pliegue">
            <summary>Ver las {blocked.length} unidades</summary>
            <div className="rejilla-placas">{blocked.map((v) => (
              <span key={v} className="placa-casilla mala"><span className="p">{v}</span></span>))}</div>
          </details>
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

        <div className="lista-unidades">
          {(rounds ?? []).map((r) => {
            const items = inspByRound[r.id] ?? [];
            const okc = items.filter((i) => i.ok).length;
            return (
              <div key={r.id} className={"fila-unidad " + (r.status === "open" ? "est-ok" : "est-off")}
                style={{ gridTemplateColumns: "1fr", gap: 0, alignItems: "stretch" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div className="unidad-id">
                    <span className="unidad-placa" style={{ fontSize: 14 }}>{r.label}</span>
                    {r.status === "open" ? <span className="badge ok">Abierta</span> : <span className="badge neutral">Cerrada</span>}
                    {r.responsible ? <span className="unidad-datos">{r.responsible}</span> : null}
                  </div>
                  <div className="fila-acciones">
                    <span className="unidad-datos">{items.length} inspección(es) · {okc} en buen estado · {items.length - okc} con novedades</span>
                    <RoundActions roundId={r.id} label={r.label} inspections={items.length} />
                  </div>
                </div>
                {items.length > 0 && (
                  <details className="pliegue">
                    <summary>Ver las {items.length} unidades del turno</summary>
                    <div className="rejilla-placas">
                      {items.map((i, k) => (
                        <span key={k} className={"placa-casilla" + (i.ok ? "" : " mala")}>
                          <span className="p">{i.plate}</span><span className="h">{i.time}</span>
                        </span>
                      ))}
                    </div>
                  </details>
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
