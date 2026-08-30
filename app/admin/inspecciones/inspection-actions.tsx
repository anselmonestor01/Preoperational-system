"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtKm } from "@/lib/format";

export default function InspectionActions({
  id, status, authorized, operation,
}: { id: string; status: string; authorized: boolean | null; operation: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [answers, setAnswers] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [evidence, setEvidence] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  async function load() {
    setOpen(true);
    const [{ data: insp }, { data: ans }, { data: iss }] = await Promise.all([
      supabase.from("inspections").select("*").eq("id", id).maybeSingle(),
      supabase.from("inspection_answers").select("*").eq("inspection_id", id).order("severity"),
      supabase.from("issues").select("*").eq("inspection_id", id),
    ]);
    setDetail(insp); setAnswers(ans ?? []); setIssues(iss ?? []);
    // Evidencias por novedad (signed URLs).
    if (iss && iss.length) {
      const { data: evs } = await supabase.from("issue_evidence").select("issue_id,storage_path").in("issue_id", iss.map((i: any) => i.id));
      const map: Record<string, string[]> = {};
      for (const e of evs ?? []) {
        const { data: signed } = await supabase.storage.from("evidence").createSignedUrl(e.storage_path, 3600);
        if (signed?.signedUrl) (map[e.issue_id] ??= []).push(signed.signedUrl);
      }
      setEvidence(map);
    }
  }

  async function doOverride(authorize: boolean) {
    const reason = window.prompt(`Motivo del override (${authorize ? "AUTORIZAR" : "RECHAZAR"}):`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    const { error } = await supabase.rpc("override_authorization", { p_inspection_id: id, p_authorize: authorize, p_reason: reason });
    setBusy(false);
    if (error) return show(error.message);
    show("Override aplicado"); setOpen(false); router.refresh();
  }
  async function doVoid() {
    const reason = window.prompt("Motivo de anulación:");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    const { error } = await supabase.rpc("void_inspection", { p_inspection_id: id, p_reason: reason });
    setBusy(false);
    if (error) return show(error.message);
    show("Inspección anulada"); setOpen(false); router.refresh();
  }
  async function doRelease() {
    if (!window.confirm("¿Liberar el vehículo para re-inspección en esta ronda? La inspección se conserva en el histórico.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("release_inspection", { p_inspection_id: id });
    setBusy(false);
    if (error) return show(error.message);
    show("Vehículo liberado"); setOpen(false); router.refresh();
  }

  const sevBadge = (s: string) => <span className={"badge " + (s === "bad" ? "bad" : s === "warn" ? "warn" : "ok")}>{s === "bad" ? "Malo" : s === "warn" ? "Regular" : "Bueno"}</span>;

  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={load}>Detalle</button>
      {open && (
        <div className="drawer-scrim" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="drawer">
            <div className="drawer-head">
              <div><div style={{ fontWeight: 700, fontSize: 18 }}>{detail?.vehicle_plate ?? "…"}</div>
                <div className="cell-sub">{detail?.driver_name} · {fmtDateTime(detail?.submitted_at)}</div></div>
              <button className="sheet-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="drawer-body">
              {!detail ? <div className="spinner" /> : (<>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                  {detail.status === "voided" ? <span className="badge neutral">Anulada</span>
                    : detail.authorized === false ? <span className="result-pill bad">NO AUTORIZADO</span>
                    : <span className="result-pill ok">AUTORIZADO</span>}
                  <span className={"result-pill " + (detail.result === "bueno" ? "ok" : detail.result === "regular" ? "warn" : "bad")}>{detail.result}</span>
                </div>

                <div className="panel" style={{ padding: 16 }}>
                  <div className="sum-row"><span className="k">Ronda</span><span className="v">#{detail.round_id ? "—" : "—"} · v{detail.checklist_version_number}</span></div>
                  <div className="sum-row"><span className="k">Km inicial</span><span className="v">{fmtKm(detail.km_inicial)}</span></div>
                  <div className="sum-row"><span className="k">Km final</span><span className="v">{fmtKm(detail.km_final)}</span></div>
                  <div className="sum-row"><span className="k">Recorrido</span><span className="v">{detail.recorrido != null ? fmtKm(detail.recorrido) : "—"}</span></div>
                  <div className="sum-row"><span className="k">Combustible</span><span className="v">{detail.fuel_in ?? "—"}{detail.fuel_out ? ` → ${detail.fuel_out}` : ""}</span></div>
                  <div className="sum-row"><span className="k">Resumen</span><span className="v">{detail.ok_count} ok · {detail.warn_count} reg · {detail.bad_count} malo</span></div>
                  {detail.obs_general && <div style={{ marginTop: 8, fontSize: 13 }}><b>Obs:</b> {detail.obs_general}</div>}
                </div>

                {Array.isArray(detail.auth_reasons) && detail.auth_reasons.length > 0 && (
                  <div className="error-box" style={{ marginTop: 12 }}>
                    <b>Razones de no autorización:</b>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                      {detail.auth_reasons.map((r: any, i: number) => <li key={i}>{typeof r === "string" ? r : JSON.stringify(r)}</li>)}
                    </ul>
                  </div>
                )}

                {issues.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div className="panel-title">Novedades ({issues.length})</div>
                    {issues.map((i) => (
                      <div key={i.id} className="panel" style={{ padding: 14, marginTop: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <b>{i.item_name}</b>{sevBadge(i.severity)}
                        </div>
                        <div style={{ fontSize: 13, marginTop: 4 }}>{i.description || "Sin detalle"}</div>
                        {evidence[i.id]?.length ? (
                          <div className="evidence-row" style={{ marginTop: 8 }}>
                            {evidence[i.id].map((u, k) => <img key={k} src={u} alt="" className="evidence-thumb" />)}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}

                <details style={{ marginTop: 16 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>Respuestas del checklist ({answers.length})</summary>
                  <div style={{ marginTop: 8 }}>
                    {answers.map((a) => (
                      <div key={a.id} className="sum-row"><span className="k">{a.item_name}</span>
                        <span className="v">{a.value} {sevBadge(a.severity)}</span></div>
                    ))}
                  </div>
                </details>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
                  {detail.status !== "voided" && detail.authorized === false &&
                    <button className="btn btn-success btn-sm" disabled={busy} onClick={() => doOverride(true)}>Override: Autorizar</button>}
                  {detail.status !== "voided" && detail.authorized === true &&
                    <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => doOverride(false)}>Override: Rechazar</button>}
                  {detail.status !== "voided" &&
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doRelease}>Liberar vehículo</button>}
                  {detail.status !== "voided" &&
                    <button className="btn btn-danger btn-sm" disabled={busy} onClick={doVoid}>Anular</button>}
                </div>
              </>)}
            </div>
          </div>
        </div>
      )}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
