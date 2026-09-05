"use client";

// Detalle de una inspección y acciones de supervisión (anular, liberar,
// sobrescribir veredicto). Cada acción pasa por un RPC que revalida permisos.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtKm } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { useDialog } from "@/components/ui/dialogs";
import EvidenceGallery from "@/components/EvidenceGallery";

export default function InspectionActions({ id }: { id: string }) {
  const supabase = createClient();
  const router = useRouter();
  const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [answers, setAnswers] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [eviByIssue, setEviByIssue] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  // Cierre supervisado de una operación que no cumple la permanencia mínima:
  // un movimiento de patio de dos minutos, o un conductor que se marchó sin
  // registrar el regreso. Con motivo obligatorio y rastro en la auditoría.
  const [cerrando, setCerrando] = useState(false);
  const [kmCierre, setKmCierre] = useState("");
  const [fuelCierre, setFuelCierre] = useState("lleno");
  const [motivoCierre, setMotivoCierre] = useState("");
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
    const reason = await dialog.prompt({
      title: authorize ? "Autorizar manualmente" : "Rechazar manualmente",
      message: "Queda registrado quién cambió el veredicto del sistema y por qué.",
      label: "Motivo",
      placeholder: "Explica el motivo (mínimo 3 caracteres)",
      required: true,
      multiline: true,
      confirmLabel: authorize ? "Autorizar" : "Rechazar",
      tone: authorize ? "default" : "danger",
    });
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    const { error } = await supabase.rpc("override_authorization", { p_inspection_id: id, p_authorize: authorize, p_reason: reason });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible aplicar el override."));
    show("Override aplicado"); setOpen(false); router.refresh();
  }
  async function doVoid() {
    const reason = await dialog.prompt({
      title: "Anular inspección",
      message: "La inspección deja de contar para la operación, pero se conserva en el historial.",
      label: "Motivo de anulación",
      placeholder: "Explica el motivo (mínimo 3 caracteres)",
      required: true,
      multiline: true,
      confirmLabel: "Anular",
      tone: "danger",
    });
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    const { error } = await supabase.rpc("void_inspection", { p_inspection_id: id, p_reason: reason });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible anular."));
    show("Inspección anulada"); setOpen(false); router.refresh();
  }
  // Borrado definitivo: elimina la inspección y todo su rastro. Si la ronda se
  // queda sin inspecciones, el propio RPC la elimina, de modo que el historial
  // queda como si nunca se hubiera hecho esa ronda de prueba.
  async function doDelete() {
    const password = await dialog.confirmWithPassword({
      title: "Eliminar inspección definitivamente",
      message: `Se borrará la inspección de ${detail?.vehicle_plate ?? "este vehículo"} junto con sus respuestas, novedades y evidencias fotográficas. Si es la única inspección de su ronda, la ronda también se eliminará.`,
      warning: "Esta acción no se puede deshacer.",
      confirmLabel: "Eliminar todo el registro",
      tone: "danger",
    });
    if (password === null) return;

    setBusy(true);
    const { data, error } = await supabase.rpc("delete_inspection", { p_inspection_id: id, p_password: password });
    if (error) { setBusy(false); return show(friendlyError(error, "No fue posible eliminar la inspección.")); }

    const paths: string[] = data?.storage_paths ?? [];
    if (paths.length) await supabase.storage.from("evidence").remove(paths);

    setBusy(false);
    show(data?.round_deleted ? `Inspección eliminada. La ronda "${data.round_label}" quedó vacía y también se eliminó.` : "Inspección eliminada");
    setOpen(false);
    router.refresh();
  }

  async function doRelease() {
    const ok = await dialog.confirm({
      title: "Liberar vehículo",
      message: "Podrá volver a inspeccionarse en esta ronda. La inspección actual se conserva.",
      confirmLabel: "Liberar",
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.rpc("release_inspection", { p_inspection_id: id });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible liberar."));
    show("Vehículo liberado"); setOpen(false); router.refresh();
  }

  async function doForceClose() {
    if (motivoCierre.trim().length < 5) return show("Indica el motivo del cierre manual (mínimo 5 caracteres).");
    setBusy(true);
    const { data, error } = await supabase.rpc("force_close_operation", {
      p_inspection_id: id,
      p_km_final: kmCierre ? Number(kmCierre) : null,
      p_fuel_out: fuelCierre,
      p_reason: motivoCierre,
    });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible cerrar la operación."));
    show(data?.vehiculo_liberado ? "Operación cerrada. El vehículo queda disponible." : "Operación cerrada. El vehículo sigue con novedades pendientes.");
    setCerrando(false); setMotivoCierre(""); setKmCierre("");
    setOpen(false); router.refresh();
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
              {detail.operation_status === "open" && (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line-soft)" }}>
                  <div className="cell-sub" style={{ marginBottom: 8 }}>
                    <b>Operación en ruta.</b> El regreso lo registra el conductor desde el kiosco
                    con su PIN. Ciérrala aquí sólo si eso no es posible: un movimiento de patio
                    más corto que la permanencia mínima, o un conductor que se fue sin registrarlo.
                  </div>
                  {!cerrando ? (
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setCerrando(true)}>
                      Cerrar operación manualmente
                    </button>
                  ) : (
                    <div className="summary-card">
                      <div className="field-label" style={{ marginTop: 0 }}>Kilometraje final</div>
                      <input className="manage-input" style={{ width: "100%" }} inputMode="numeric" value={kmCierre}
                        onChange={(e) => setKmCierre(e.target.value.replace(/\D/g, "").slice(0, 7))}
                        placeholder={detail.km_inicial != null ? `Mínimo ${detail.km_inicial}` : "Km al regresar"} />

                      <div className="field-label">Combustible al regresar</div>
                      <select className="manage-input" style={{ width: "100%" }} value={fuelCierre}
                        onChange={(e) => setFuelCierre(e.target.value)}>
                        <option value="lleno">Lleno</option>
                        <option value="medio">Medio</option>
                        <option value="bajo">Bajo</option>
                      </select>

                      <div className="field-label">Motivo del cierre manual</div>
                      <textarea className="manage-input" style={{ width: "100%", minHeight: 62 }} value={motivoCierre}
                        onChange={(e) => setMotivoCierre(e.target.value.slice(0, 300))}
                        placeholder="Queda registrado en la auditoría con tu nombre" />

                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={doForceClose}>Cerrar operación</button>
                        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setCerrando(false)}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line-soft)" }}>
                <div className="cell-sub" style={{ marginBottom: 8 }}>
                  <b>Depurar historial.</b> Anular conserva el registro; eliminar lo borra por completo.
                  Úsalo para quitar inspecciones de prueba.
                </div>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={doDelete}
                  style={{ color: "var(--red)", borderColor: "rgba(198,66,60,.25)" }}>
                  Eliminar inspección definitivamente
                </button>
              </div>
            </>)}
          </div>
        </div>
      )}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
