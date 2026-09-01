"use client";

// Detalle de una inspección y acciones de supervisión (anular, liberar,
// sobrescribir veredicto). Cada acción pasa por un RPC que revalida permisos.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtKm } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import EvidenceGallery from "@/components/EvidenceGallery";

export default function InspectionActions({ id }: { id: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [answers, setAnswers] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [eviByIssue, setEviByIssue] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };

  async function load() {
    setOpen(true);
    const [{ data: insp }, { data: ans }, { data: iss }] = await Promise.all([
      supabase.from("inspections").select("*").eq("id", id).maybeSingle(),
      supabase.from("inspection_answers").select("*").eq("inspection_id", id).order("severity"),
      supabase.from("issues").select("*").eq("inspection_id", id),
    ]);
    setDetail(insp); setAnswers(ans ?? []); setIssues(iss ?? []);
    const { data: evs } = await supabase.from("issue_evidence").select("issue_id,storage_path").eq("inspection_id", id);
    const paths = (evs ?? []).map((e) => e.storage_path);
    if (paths.length) {
      const { data: signed } = await supabase.storage.from("evidence").createSignedUrls(paths, 3600);
      const map: Record<string, string> = {};
      (signed ?? []).forEach((s) => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl; });
      const byIssue: Record<string, string[]> = {};
      (evs ?? []).forEach((e) => { if (map[e.storage_path]) (byIssue[e.issue_id ?? "_"] ??= []).push(map[e.storage_path]); });
      setEviByIssue(byIssue);
    } else setEviByIssue({});
  }

  async function doOverride(authorize: boolean) {
    const reason = window.prompt(`Motivo del override (${authorize ? "AUTORIZAR" : "RECHAZAR"}):`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    const { error } = await supabase.rpc("override_authorization", { p_inspection_id: id, p_authorize: authorize, p_reason: reason });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible aplicar el override."));
    show("Override aplicado"); setOpen(false); router.refresh();
  }
  async function doVoid() {
    const reason = window.prompt("Motivo de anulación:");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    const { error } = await supabase.rpc("void_inspection", { p_inspection_id: id, p_reason: reason });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible anular."));
    show("Inspección anulada"); setOpen(false); router.refresh();
  }
  async function doRelease() {
    if (!window.confirm("¿Liberar el vehículo para re-inspección en esta ronda? La inspección se conserva.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("release_inspection", { p_inspection_id: id });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible liberar."));
    show("Vehículo liberado"); setOpen(false); router.refresh();
  }

  const sevBadge = (s: string) => <span className={"badge " + (s === "bad" ? "bad" : s === "warn" ? "warn" : "ok")}>{s === "bad" ? "Malo" : s === "warn" ? "Regular" : "Bueno"}</span>;

  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={load}>Detalle</button>
      {open && (
        <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="sheet wide">
            <div className="sheet-head">
              <div><div className="sheet-title">{detail?.vehicle_plate ?? "…"}</div>
                <div className="cell-sub">{detail?.driver_name} · {fmtDateTime(detail?.submitted_at)}</div></div>
              <button className="sheet-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            {!detail ? <div className="spinner" /> : (<>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {detail.status === "voided" ? <span className="badge neutral">Anulada</span>
                  : detail.authorized === false ? <span className="result-pill bad">NO AUTORIZADO</span>
                    : <span className="result-pill ok">AUTORIZADO</span>}
                <span className={"result-pill " + (detail.result === "bueno" ? "ok" : detail.result === "regular" ? "warn" : "bad")}>{detail.result}</span>
              </div>

              <div className="summary-card">
                <div className="summary-row"><span className="cell-sub">Km inicial</span><span>{fmtKm(detail.km_inicial)}</span></div>
                <div className="summary-row"><span className="cell-sub">Km final</span><span>{fmtKm(detail.km_final)}</span></div>
                <div className="summary-row"><span className="cell-sub">Recorrido</span><span>{detail.recorrido != null ? fmtKm(detail.recorrido) : "—"}</span></div>
                <div className="summary-row"><span className="cell-sub">Combustible</span><span>{detail.fuel_in ?? "—"}{detail.fuel_out ? ` → ${detail.fuel_out}` : ""}</span></div>
                <div className="summary-row"><span className="cell-sub">Resumen checklist</span><span>{detail.ok_count} ok · {detail.warn_count} reg · {detail.bad_count} malo</span></div>
                <div className="summary-row"><span className="cell-sub">Versión checklist</span><span>v{detail.checklist_version_number}</span></div>
              </div>
              {detail.obs_general ? <div style={{ margin: "10px 0", fontSize: 13 }}><b>Observaciones:</b> {detail.obs_general}</div> : null}

              {Array.isArray(detail.auth_reasons) && detail.auth_reasons.length > 0 && (
                <div className="err-box" style={{ marginTop: 12 }}>
                  <b>Razones de no autorización:</b>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {detail.auth_reasons.map((r: any, i: number) => <li key={i}>{typeof r === "string" ? r : JSON.stringify(r)}</li>)}
                  </ul>
                </div>
              )}

              {issues.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="panel-title" style={{ marginBottom: 8 }}>Novedades ({issues.length})</div>
                  {issues.map((i) => (
                    <div key={i.id} className="issue-card" style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <b>{i.item_name}</b>{sevBadge(i.severity)}
                      </div>
                      <div style={{ fontSize: 13, margin: "4px 0 8px" }}>{i.description || "Sin detalle"}</div>
                      <EvidenceGallery urls={eviByIssue[i.id] ?? []} size={72} empty="Sin evidencia" />
                    </div>
                  ))}
                </div>
              )}

              <details style={{ marginTop: 16 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Respuestas del checklist ({answers.length})</summary>
                <div style={{ marginTop: 8 }}>
                  {answers.map((a) => (
                    <div key={a.id} className="summary-row"><span className="cell-sub">{a.item_name}</span><span>{a.value} {sevBadge(a.severity)}</span></div>
                  ))}
                </div>
              </details>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
                {detail.status !== "voided" && detail.authorized === false && <button className="btn btn-success btn-sm" disabled={busy} onClick={() => doOverride(true)}>Override: Autorizar</button>}
                {detail.status !== "voided" && detail.authorized === true && <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => doOverride(false)}>Override: Rechazar</button>}
                {detail.status !== "voided" && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doRelease}>Liberar vehículo</button>}
                {detail.status !== "voided" && <button className="btn btn-danger btn-sm" disabled={busy} onClick={doVoid}>Anular</button>}
              </div>
            </>)}
          </div>
        </div>
      )}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
