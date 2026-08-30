"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

// Botón + modal para crear una nueva ronda personalizada.
// Iniciar una ronda cierra la vigente y reinicia el tablero operativo
// (los bloqueos "inspeccionado en ronda" se limpian; los bloqueos por
// novedad o administrativos persisten según las reglas del sistema).
export default function NewRoundButton({ hasOpen, compact }: { hasOpen: boolean; compact?: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [responsible, setResponsible] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  async function submit() {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("start_round", {
      p_label: label, p_responsible: responsible, p_notes: notes,
    });
    setBusy(false);
    if (error) { setErr(friendlyError(error, "No fue posible iniciar la ronda.")); return; }
    setOpen(false); setLabel(""); setResponsible(""); setNotes("");
    setToast(`Ronda iniciada: ${data?.label ?? ""}`);
    setTimeout(() => setToast(""), 2600);
    router.refresh();
  }

  return (
    <>
      <button className={"btn btn-primary" + (compact ? " btn-sm" : "")} style={{ flexShrink: 0 }} onClick={() => setOpen(true)}>
        Nueva ronda
      </button>
      {open && (
        <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="sheet" style={{ maxWidth: 460 }}>
            <div className="sheet-head">
              <div><div className="sheet-title">Iniciar nueva ronda</div><div className="sheet-tag">Operación</div></div>
              <button className="sheet-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            {hasOpen && (
              <div className="err-box" style={{ background: "var(--orange-soft)", color: "var(--orange)", marginBottom: 12 }}>
                Iniciar una ronda nueva cerrará la ronda vigente y reiniciará el tablero de vehículos disponibles.
              </div>
            )}
            <div className="field-label">Nombre de la ronda</div>
            <input className="manage-input" style={{ width: "100%" }} value={label}
              onChange={(e) => setLabel(e.target.value)} placeholder='Ej. "Operación Cartagena — turno tarde"' />
            <div className="field-label">Responsable <span className="optional-tag">(opcional)</span></div>
            <input className="manage-input" style={{ width: "100%" }} value={responsible}
              onChange={(e) => setResponsible(e.target.value)} placeholder="Nombre del supervisor a cargo" />
            <div className="field-label">Observaciones <span className="optional-tag">(opcional)</span></div>
            <textarea className="manage-input" style={{ width: "100%", minHeight: 70 }} value={notes}
              onChange={(e) => setNotes(e.target.value)} placeholder="Contexto de la ronda…" />
            {err && <div className="err-box" style={{ marginTop: 12 }}>{err}</div>}
            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy} onClick={submit}>
              {busy ? "Iniciando…" : "Iniciar ronda"}
            </button>
          </div>
        </div>
      )}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
