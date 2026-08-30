"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { optionsFor, severityOf, previewResult } from "@/lib/checklist";
import { fmtKm, initials } from "@/lib/format";
import type { AnswerPayload, ItemType, Severity } from "@/lib/types";

type Step = "home" | "driver" | "vehicle" | "datos" | "inspect" | "summary" | "final";
type CItem = { id: string; name: string; item_type: ItemType; is_safety_critical: boolean };
type CCat = { key: string; name: string; icon: string; items: CItem[] };
type Veh = { id: string; plate: string; availability: string; admin_block_reason: string | null; open_issue_count: number };
type Drv = { id: string; full_name: string; photo_path: string | null; photoUrl?: string | null };
type OpenOp = { id: string; vehicle_plate: string | null; driver_name: string | null; km_inicial: number | null };

export default function KioskApp({ orgId }: { profileName: string; orgId: string }) {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState<{ id: string; label: string } | null>(null);
  const [checklist, setChecklist] = useState<CCat[]>([]);
  const [drivers, setDrivers] = useState<Drv[]>([]);
  const [vehicles, setVehicles] = useState<Veh[]>([]);
  const [openOps, setOpenOps] = useState<OpenOp[]>([]);

  const [step, setStep] = useState<Step>("home");
  const [driver, setDriver] = useState<{ id: string; name: string } | null>(null);
  const [vehicle, setVehicle] = useState<{ id: string; plate: string } | null>(null);
  const [catIndex, setCatIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Record<string, { note: string; evidence: { path: string; preview: string }[] }>>({});
  const [kmInicial, setKmInicial] = useState("");
  const [fuelIn, setFuelIn] = useState("lleno");
  const [obs, setObs] = useState("");
  const [confirmChk, setConfirmChk] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  const [toast, setToast] = useState("");
  const idemRef = useRef<string>("");
  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2600);
  }, []);

  const loadData = useCallback(async () => {
    const [{ data: boot }, cats, drv, veh, ops] = await Promise.all([
      supabase.rpc("app_bootstrap"),
      supabase.from("checklist_versions").select("structure").eq("active", true).maybeSingle(),
      supabase.from("drivers").select("id,full_name,photo_path").eq("active", true).order("full_name"),
      supabase.from("vehicle_status_view").select("id,plate,availability,admin_block_reason,open_issue_count").eq("status", "active").order("plate"),
      supabase.from("inspections").select("id,vehicle_plate,driver_name,km_inicial").eq("operation_status", "open"),
    ]);
    const activeRound = boot?.active_round ? { id: boot.active_round.id, label: boot.active_round.label } : null;
    setRound(activeRound);
    setChecklist((cats?.data?.structure as CCat[]) ?? []);
    // Fotos de conductor (URLs firmadas del bucket privado).
    const dRows = ((drv.data as Drv[]) ?? []);
    const dPaths = dRows.filter((d) => d.photo_path).map((d) => d.photo_path!) as string[];
    if (dPaths.length) {
      const { data: signed } = await supabase.storage.from("driver-photos").createSignedUrls(dPaths, 3600);
      const map: Record<string, string> = {};
      (signed ?? []).forEach((s) => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl; });
      dRows.forEach((d) => { d.photoUrl = d.photo_path ? map[d.photo_path] ?? null : null; });
    }
    setDrivers(dRows);
    setVehicles((veh.data as Veh[]) ?? []);
    setOpenOps((ops.data as OpenOp[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // Estado de bloqueo desde la VISTA ÚNICA de verdad (coincide con el panel admin).
  function vehBlock(v: Veh): { label: string; detail: string } | null {
    switch (v.availability) {
      case "admin_blocked": return { label: "Bloqueado por administración", detail: v.admin_block_reason || "Sin motivo" };
      case "issues": return { label: "Novedades pendientes", detail: `${v.open_issue_count} sin resolver` };
      case "inspected": return { label: "Ya inspeccionado en esta ronda", detail: round?.label || "" };
      case "out_of_service": return { label: "Fuera de servicio", detail: "" };
      default: return null;
    }
  }

  function resetFlow() {
    setDriver(null); setVehicle(null); setCatIndex(0); setAnswers({}); setIssues({});
    setKmInicial(""); setFuelIn("lleno"); setObs(""); setConfirmChk(false); setResult(null);
    idemRef.current = "";
  }

  // ---- PIN ----
  const [pinFor, setPinFor] = useState<Drv | null>(null);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  async function confirmPin() {
    if (!pinFor) return;
    setPinBusy(true); setPinErr("");
    const { data, error } = await supabase.rpc("verify_driver_pin", { p_driver_id: pinFor.id, p_pin: pin });
    setPinBusy(false);
    if (error) { setPinErr("Error al verificar. Intente de nuevo."); return; }
    if (data?.ok) {
      setDriver({ id: pinFor.id, name: pinFor.full_name });
      setPinFor(null); setPin("");
      showToast("Identidad verificada: " + pinFor.full_name);
    } else {
      setPinErr("PIN incorrecto. Inténtalo de nuevo."); setPin("");
    }
  }

  // ---- Issue sheet (novedad + evidencia) ----
  const [issueItem, setIssueItem] = useState<CItem | null>(null);
  const [issueNote, setIssueNote] = useState("");
  const [issueEv, setIssueEv] = useState<{ path: string; preview: string }[]>([]);
  const [uploadingEv, setUploadingEv] = useState(false);

  function openIssue(item: CItem) {
    const cur = issues[item.id];
    setIssueItem(item);
    setIssueNote(cur?.note ?? "");
    setIssueEv(cur?.evidence ?? []);
  }
  async function uploadEvidence(file: File) {
    if (issueEv.length >= 3) { showToast("Máximo 3 fotos por novedad"); return; }
    setUploadingEv(true);
    const path = `${orgId}/tmp/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await supabase.storage.from("evidence").upload(path, file, { upsert: false });
    setUploadingEv(false);
    if (error) { showToast("No se pudo subir la foto"); return; }
    const preview = URL.createObjectURL(file);
    setIssueEv((e) => [...e, { path, preview }]);
  }
  function saveIssue() {
    if (!issueItem) return;
    setIssues((s) => ({ ...s, [issueItem.id]: { note: issueNote, evidence: issueEv } }));
    setIssueItem(null);
  }

  function setAnswer(item: CItem, value: string) {
    setAnswers((a) => ({ ...a, [item.id]: value }));
    const sev = severityOf(item.item_type, value);
    if (sev === "bad" || sev === "warn") openIssue(item);
  }

  // ---- Draft autosave ----
  const saveDraft = useCallback(async () => {
    if (!driver || !vehicle) return;
    const payload = buildAnswers(checklist, answers, issues);
    await supabase.rpc("save_inspection_draft", {
      p_vehicle_id: vehicle.id, p_driver_id: driver.id, p_answers: payload,
      p_km_inicial: kmInicial ? Number(kmInicial) : null, p_fuel_in: fuelIn, p_obs: obs,
    });
  }, [driver, vehicle, checklist, answers, issues, kmInicial, fuelIn, obs, supabase]);

  useEffect(() => {
    if ((step === "inspect" || step === "datos" || step === "summary") && driver && vehicle) {
      const t = setTimeout(() => { saveDraft().catch(() => {}); }, 1500);
      return () => clearTimeout(t);
    }
  }, [answers, kmInicial, fuelIn, obs, step, driver, vehicle, saveDraft]);

  // ---- Counts / summary ----
  function counts() {
    let ok = 0, warn = 0, bad = 0;
    for (const cat of checklist) for (const it of cat.items) {
      const v = answers[it.id]; if (!v) continue;
      const s = severityOf(it.item_type, v);
      if (s === "ok") ok++; else if (s === "warn") warn++; else if (s === "bad") bad++;
    }
    return { ok, warn, bad };
  }
  const totalItems = checklist.reduce((n, c) => n + c.items.length, 0);
  const answeredCount = Object.keys(answers).length;

  async function submit() {
    if (!driver || !vehicle || submitting) return;
    setSubmitting(true);
    if (!idemRef.current) idemRef.current = `${vehicle.id}:${round?.id}:${crypto.randomUUID()}`;
    const payload = buildAnswers(checklist, answers, issues);
    const { data, error } = await supabase.rpc("submit_inspection", {
      p_vehicle_id: vehicle.id, p_driver_id: driver.id, p_answers: payload,
      p_km_inicial: kmInicial ? Number(kmInicial) : null, p_fuel_in: fuelIn,
      p_obs: obs, p_idempotency_key: idemRef.current,
    });
    setSubmitting(false);
    if (error) { showToast(error.message || "Error al registrar la inspección"); return; }
    setResult(data);
    setStep("final");
    loadData();
  }

  // ---- Registrar regreso ----
  const [cierreOp, setCierreOp] = useState<OpenOp | null>(null);
  const [kmFinal, setKmFinal] = useState("");
  const [fuelOut, setFuelOut] = useState("lleno");
  const [cierreBusy, setCierreBusy] = useState(false);
  async function doReturn() {
    if (!cierreOp) return;
    setCierreBusy(true);
    const { error } = await supabase.rpc("register_return", {
      p_inspection_id: cierreOp.id, p_km_final: kmFinal ? Number(kmFinal) : null, p_fuel_out: fuelOut,
    });
    setCierreBusy(false);
    if (error) { showToast(error.message); return; }
    showToast("Regreso registrado. Operación cerrada.");
    setCierreOp(null); setKmFinal(""); loadData();
  }

  if (loading) {
    return <div className="driver-shell"><div className="spinner" /></div>;
  }
  if (!round) {
    return (
      <div className="driver-shell"><div className="d-body">
        <div className="stub"><h3>Sin ronda abierta</h3>
          <p>No hay una ronda de inspección abierta. Solicite a administración que inicie una ronda.</p></div>
      </div></div>
    );
  }

  const rail = (n: number) => (
    <>
      <div className="progress-rail">{[1, 2, 3, 4, 5].map((i) => <div key={i} className={"seg" + (i <= n ? " done" : "")} />)}</div>
      <div className="progress-label">Paso {n} de 5</div>
    </>
  );

  return (
    <div className="driver-shell">
      {/* HOME */}
      {step === "home" && (
        <div className="d-body">
          <div className="home2-header">
            <div>
              <div><span className="home2-brandtext"><span className="l1">MUNDO</span><span className="l2">MARÍTIMO</span></span></div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Sistema Preoperacional · {round.label}</div>
            </div>
            <div className="home2-status"><span className="home2-dot" />En línea</div>
          </div>
          <div className="home2-hero" style={{ backgroundImage: "url('/home-hero.png')" }}>
            <div className="home2-hero-caption"><span>Flota operativa</span><span className="tag">Preoperacional</span></div>
          </div>
          <div className="home2-cta">
            <div className="home2-cta-kicker">Inspección preoperacional</div>
            <h1 className="home2-cta-title">Revise su vehículo antes de salir</h1>
            <p className="home2-cta-sub">Checklist obligatorio en menos de 5 minutos. Registra el estado de su unidad antes de iniciar la ruta.</p>
            <button className="home2-btn" onClick={() => { resetFlow(); setStep("driver"); }}>
              Comenzar inspección
              <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div className="home2-meta">
            <span><strong>~5 min</strong>Duración</span>
            <span><strong>100%</strong>Seguridad</span>
            <span><strong>Digital</strong>Registro</span>
          </div>
          {openOps.length > 0 && (
            <button className="btn btn-ghost btn-block" style={{ marginTop: 14 }} onClick={() => setCierreOp(openOps[0])}>
              Registrar regreso ({openOps.length} operación{openOps.length > 1 ? "es" : ""} abierta{openOps.length > 1 ? "s" : ""})
            </button>
          )}
          <form action="/auth/signout" method="post">
            <button type="submit" className="home2-admin">Cerrar sesión del kiosco</button>
          </form>
        </div>
      )}

      {/* DRIVER */}
      {step === "driver" && (
        <>
          <TopBar onBack={() => setStep("home")} />
          {rail(1)}
          <div className="d-body">
            <h2 className="step-title">Seleccione al conductor</h2>
            <p className="step-sub">¿Quién realizará la inspección?</p>
            <div className="pick-list">
              {drivers.map((d) => {
                const sel = driver?.id === d.id;
                return (
                  <div key={d.id} className={"pick-row" + (sel ? " selected" : "")} onClick={() => setPinFor(d)}>
                    <div className="pick-avatar">{d.photoUrl ? <img src={d.photoUrl} alt="" className="drv-photo" /> : initials(d.full_name)}</div>
                    <div className="pick-main"><div className="pick-name">{d.full_name}</div>
                      <div className="pick-sub">{sel ? "Identidad verificada con PIN" : "Toca para verificar con tu PIN"}</div></div>
                    <div className="pick-check">{sel ? "✓" : ""}</div>
                  </div>
                );
              })}
              {drivers.length === 0 && <div className="empty-state">No hay conductores registrados.</div>}
            </div>
          </div>
          <div className="d-footer">
            <button className="btn btn-primary btn-block" disabled={!driver} onClick={() => setStep("vehicle")}>Siguiente</button>
          </div>
        </>
      )}

      {/* VEHICLE */}
      {step === "vehicle" && (
        <>
          <TopBar onBack={() => setStep("driver")} />
          {rail(2)}
          <div className="d-body">
            <h2 className="step-title">Seleccione el vehículo</h2>
            <p className="step-sub">Elija el vehículo que va a inspeccionar.</p>
            <div className="round-banner">Ronda vigente: <b>{round.label}</b></div>
            <div className="pick-list">
              {vehicles.map((v) => {
                const block = vehBlock(v);
                const sel = vehicle?.id === v.id;
                if (block) return (
                  <div key={v.id} className="pick-row locked" title={block.label}>
                    <div className="pick-avatar" style={{ background: "var(--red-soft)", color: "var(--red)" }}>🔒</div>
                    <div className="pick-main"><div className="pick-name" style={{ color: "var(--muted)" }}>{v.plate}</div>
                      <div className="pick-sub" style={{ color: "var(--red)" }}>{block.label} · {block.detail}</div></div>
                  </div>
                );
                return (
                  <div key={v.id} className={"pick-row" + (sel ? " selected" : "")} onClick={() => setVehicle({ id: v.id, plate: v.plate })}>
                    <div className="pick-avatar">🚚</div>
                    <div className="pick-main"><div className="pick-name">{v.plate}</div><div className="pick-sub">Camión de carga</div></div>
                    <div className="pick-check">{sel ? "✓" : ""}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="d-footer">
            <button className="btn btn-primary btn-block" disabled={!vehicle} onClick={() => setStep("datos")}>Siguiente</button>
          </div>
        </>
      )}

      {/* DATOS */}
      {step === "datos" && (
        <>
          <TopBar onBack={() => setStep("vehicle")} />
          {rail(3)}
          <div className="d-body">
            <h2 className="step-title">Datos de salida</h2>
            <p className="step-sub">{vehicle?.plate} · {driver?.name}</p>
            <div className="field-label">Kilometraje inicial</div>
            <input className="input" inputMode="numeric" value={kmInicial}
              onChange={(e) => setKmInicial(e.target.value.replace(/[^\d]/g, ""))} placeholder="Ej. 152300" />
            <div className="field-label">Nivel de combustible</div>
            <div className="chk-opts">
              {optionsFor("nivel").map((o) => (
                <button key={o.value} className={"chk-opt" + (fuelIn === o.value ? " sel-" + o.sev : "")}
                  onClick={() => setFuelIn(o.value)}>{o.label}</button>
              ))}
            </div>
          </div>
          <div className="d-footer">
            <button className="btn btn-primary btn-block" disabled={!kmInicial}
              onClick={() => { setCatIndex(0); setStep("inspect"); }}>Iniciar checklist</button>
          </div>
        </>
      )}

      {/* INSPECT */}
      {step === "inspect" && checklist[catIndex] && (
        <>
          <TopBar onBack={() => catIndex === 0 ? setStep("datos") : setCatIndex((i) => i - 1)} />
          {rail(4)}
          <div className="d-body">
            <h2 className="step-title">{checklist[catIndex].name}</h2>
            <p className="step-sub">Categoría {catIndex + 1} de {checklist.length} · {vehicle?.plate}</p>
            {checklist[catIndex].items.map((it) => {
              const val = answers[it.id];
              const sev = val ? severityOf(it.item_type, val) : null;
              const cls = sev === "bad" ? " flagged" : sev === "warn" ? " warned" : "";
              return (
                <div key={it.id} className={"chk-item" + cls}>
                  <div className="chk-item-name">{it.name}{it.is_safety_critical && <span title="Ítem crítico de seguridad" style={{ color: "var(--red)" }}> ●</span>}</div>
                  <div className="chk-opts">
                    {optionsFor(it.item_type).map((o) => (
                      <button key={o.value} className={"chk-opt" + (val === o.value ? " sel-" + o.sev : "")}
                        onClick={() => setAnswer(it, o.value)}>{o.label}</button>
                    ))}
                  </div>
                  {(sev === "bad" || sev === "warn") && (
                    <div className="item-note" onClick={() => openIssue(it)} style={{ cursor: "pointer" }}>
                      ⚠ {issues[it.id]?.note ? issues[it.id].note : "Agregar detalle / evidencia"}
                      {issues[it.id]?.evidence?.length ? ` · ${issues[it.id].evidence.length} foto(s)` : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="d-footer">
            <button className="btn btn-primary btn-block"
              disabled={!checklist[catIndex].items.every((it) => answers[it.id])}
              onClick={() => {
                if (catIndex < checklist.length - 1) setCatIndex((i) => i + 1);
                else { idemRef.current = ""; setStep("summary"); }
              }}>
              {catIndex < checklist.length - 1 ? "Siguiente categoría" : "Ver resumen"}
            </button>
          </div>
        </>
      )}

      {/* SUMMARY */}
      {step === "summary" && (() => {
        const c = counts();
        const res = previewResult(c);
        return (
          <>
            <TopBar onBack={() => { setCatIndex(checklist.length - 1); setStep("inspect"); }} />
            {rail(5)}
            <div className="d-body">
              <h2 className="step-title">Resumen de inspección</h2>
              <p className="step-sub">Verifique antes de enviar. El resultado final lo confirma el sistema.</p>
              <div className="stat-row">
                <div className="stat-card ok"><div className="num">{c.ok}</div><div className="lbl">Bueno</div></div>
                <div className="stat-card warn"><div className="num">{c.warn}</div><div className="lbl">Regular</div></div>
                <div className="stat-card bad"><div className="num">{c.bad}</div><div className="lbl">Malo</div></div>
              </div>
              <div className="sum-row"><span className="k">Vehículo</span><span className="v">{vehicle?.plate}</span></div>
              <div className="sum-row"><span className="k">Conductor</span><span className="v">{driver?.name}</span></div>
              <div className="sum-row"><span className="k">Kilometraje</span><span className="v">{fmtKm(Number(kmInicial))}</span></div>
              <div className="sum-row"><span className="k">Resultado previsto</span>
                <span className={"result-pill " + (res === "bueno" ? "ok" : res === "regular" ? "warn" : "bad")}>{res}</span></div>
              <div className="field-label">Observaciones generales <span className="optional-tag">(opcional)</span></div>
              <textarea className="input" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Notas adicionales…" />
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, fontSize: 13.5 }}>
                <input type="checkbox" checked={confirmChk} onChange={(e) => setConfirmChk(e.target.checked)} style={{ marginTop: 3 }} />
                <span>Confirmo que la información registrada es veraz y corresponde al estado real del vehículo.</span>
              </label>
            </div>
            <div className="d-footer">
              <button className="btn btn-primary btn-block" disabled={!confirmChk || submitting || answeredCount < totalItems}
                onClick={submit}>{submitting ? "Enviando…" : "Enviar inspección"}</button>
            </div>
          </>
        );
      })()}

      {/* FINAL */}
      {step === "final" && result && (
        <div className="d-final">
          <div className="final-badge" style={{ background: result.authorized ? "var(--green-soft)" : "var(--red-soft)", color: result.authorized ? "var(--green)" : "var(--red)" }}>
            {result.authorized
              ? <svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : <svg viewBox="0 0 24 24" fill="none"><path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /></svg>}
          </div>
          <h1 style={{ fontSize: 24, margin: "6px 0" }}>{result.authorized ? "Inspección completada" : "Salida no autorizada"}</h1>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            {result.authorized
              ? "Su inspección fue registrada y el vehículo quedó autorizado."
              : "La inspección fue registrada, pero el vehículo NO puede salir:"}
          </p>
          <div style={{ margin: "14px 0" }}>
            {result.authorized
              ? <span className="result-pill ok">AUTORIZADO PARA SALIR</span>
              : <span className="result-pill bad">NO AUTORIZADO PARA SALIR</span>}
          </div>
          {!result.authorized && Array.isArray(result.reasons) && (
            <ul style={{ textAlign: "left", color: "var(--red)", fontWeight: 600, fontSize: 13, maxWidth: 340, margin: "0 auto 16px", paddingLeft: 18 }}>
              {result.reasons.map((r: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
            </ul>
          )}
          <div style={{ padding: "0 24px" }}>
            <button className="btn btn-primary btn-block" onClick={() => { resetFlow(); setStep("home"); loadData(); }}>Volver al inicio</button>
          </div>
        </div>
      )}

      {/* PIN sheet */}
      <div className={"overlay" + (pinFor ? " show" : "")} onClick={(e) => { if (e.target === e.currentTarget) setPinFor(null); }}>
        <div className="sheet" style={{ maxWidth: 380 }}>
          <div className="sheet-head"><div><div className="sheet-title">Ingresa tu PIN</div>
            <div className="cell-sub">{pinFor?.full_name}</div></div>
            <button className="sheet-close" onClick={() => setPinFor(null)}>✕</button></div>
          <div className="field-label">PIN de 4 dígitos</div>
          <input className="pin-input" inputMode="numeric" maxLength={4} type="password" value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") confirmPin(); }} autoFocus />
          {pinErr && <div className="err-box" style={{ marginTop: 10 }}>{pinErr}</div>}
          <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} disabled={pin.length < 4 || pinBusy} onClick={confirmPin}>
            {pinBusy ? "Verificando…" : "Confirmar"}</button>
        </div>
      </div>

      {/* Issue sheet */}
      <div className={"overlay" + (issueItem ? " show" : "")} onClick={(e) => { if (e.target === e.currentTarget) setIssueItem(null); }}>
        <div className="sheet">
          <div className="sheet-head"><div><div className="sheet-title">{issueItem?.name}</div>
            <div className="sheet-tag">Novedad</div></div>
            <button className="sheet-close" onClick={() => setIssueItem(null)}>✕</button></div>
          <div className="field-label">¿Qué novedad presenta?</div>
          <textarea className="input" value={issueNote} onChange={(e) => setIssueNote(e.target.value)} placeholder="Describa brevemente la novedad…" />
          <div className="field-label">Evidencia <span className="optional-tag">(opcional, máx. 3)</span></div>
          <div className="evidence-row">
            {issueEv.map((ev, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={ev.preview} alt="" className="evidence-thumb" />
                <button onClick={() => setIssueEv((e) => e.filter((_, j) => j !== i))}
                  style={{ position: "absolute", top: -6, right: -6, background: "var(--red)", color: "#fff", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer" }}>✕</button>
              </div>
            ))}
            {issueEv.length < 3 && (
              <label className="add-evidence-btn">
                {uploadingEv ? "Subiendo…" : "📷 Agregar foto"}
                <input type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadEvidence(f); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} onClick={saveIssue}>Guardar novedad</button>
        </div>
      </div>

      {/* Cierre / regreso sheet */}
      <div className={"overlay" + (cierreOp ? " show" : "")} onClick={(e) => { if (e.target === e.currentTarget) setCierreOp(null); }}>
        <div className="sheet" style={{ maxWidth: 420 }}>
          <div className="sheet-head"><div><div className="sheet-title">Registrar regreso</div>
            <div className="cell-sub">Operaciones abiertas</div></div>
            <button className="sheet-close" onClick={() => setCierreOp(null)}>✕</button></div>
          {openOps.length > 1 && (
            <select className="select" style={{ width: "100%", marginBottom: 12 }} value={cierreOp?.id}
              onChange={(e) => setCierreOp(openOps.find((o) => o.id === e.target.value) ?? null)}>
              {openOps.map((o) => <option key={o.id} value={o.id}>{o.vehicle_plate} · {o.driver_name}</option>)}
            </select>
          )}
          {cierreOp && (<>
            <div className="sum-row"><span className="k">Vehículo</span><span className="v">{cierreOp.vehicle_plate}</span></div>
            <div className="sum-row"><span className="k">Km inicial</span><span className="v">{fmtKm(cierreOp.km_inicial)}</span></div>
            <div className="field-label">Kilometraje final</div>
            <input className="input" inputMode="numeric" value={kmFinal}
              onChange={(e) => setKmFinal(e.target.value.replace(/[^\d]/g, ""))} placeholder="Ej. 152480" />
            <div className="field-label">Nivel de combustible al regreso</div>
            <div className="chk-opts">
              {optionsFor("nivel").map((o) => (
                <button key={o.value} className={"chk-opt" + (fuelOut === o.value ? " sel-" + o.sev : "")}
                  onClick={() => setFuelOut(o.value)}>{o.label}</button>
              ))}
            </div>
            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={!kmFinal || cierreBusy} onClick={doReturn}>
              {cierreBusy ? "Registrando…" : "Registrar regreso"}</button>
          </>)}
        </div>
      </div>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </div>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="d-topbar">
      <button className="d-back" onClick={onBack}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <span className="home2-brandtext"><span className="l1">MUNDO</span><span className="l2">MARÍTIMO</span></span>
      <form action="/auth/signout" method="post"><button type="submit" className="d-exit">Salir</button></form>
    </div>
  );
}

function buildAnswers(
  checklist: CCat[],
  answers: Record<string, string>,
  issues: Record<string, { note: string; evidence: { path: string; preview: string }[] }>,
): AnswerPayload[] {
  const out: AnswerPayload[] = [];
  for (const cat of checklist) {
    for (const it of cat.items) {
      const value = answers[it.id];
      if (!value) continue;
      const sev: Severity | null = severityOf(it.item_type, value);
      const iss = issues[it.id];
      out.push({
        category_key: cat.key,
        item_id: it.id,
        item_name: it.name,
        item_type: it.item_type,
        value,
        note: iss?.note || undefined,
        evidence: sev !== "ok" && iss?.evidence?.length ? iss.evidence.map((e) => e.path) : undefined,
      });
    }
  }
  return out;
}
