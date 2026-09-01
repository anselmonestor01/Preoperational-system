"use client";

// Diálogo para abrir una ronda nueva (RPC `start_round`, que impide dos abiertas).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { LIMITES, limpiarTexto, textoValido } from "@/lib/validation";

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

  // El responsable es OBLIGATORIO: una ronda sin responsable deja sin dueño la
  // decisión de qué vehículos salieron esa jornada.
  const labelOk = textoValido(label, LIMITES.nombreRonda);
  const responsableOk = textoValido(responsible, LIMITES.responsable);
  const puedeEnviar = labelOk && responsableOk && !busy;

  async function submit() {
    if (!puedeEnviar) return;
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
              maxLength={LIMITES.nombreRonda.max}
              onChange={(e) => setLabel(limpiarTexto(e.target.value, LIMITES.nombreRonda.max))}
              placeholder='Ej. "Operación Cartagena — turno tarde"' />
            {label.length > 0 && !labelOk && (
              <div className="cell-sub" style={{ color: "var(--orange)", marginTop: 6 }}>
                Mínimo {LIMITES.nombreRonda.min} caracteres.
              </div>
            )}
            <div className="field-label">Responsable</div>
            <input className="manage-input" style={{ width: "100%" }} value={responsible}
              maxLength={LIMITES.responsable.max}
              onChange={(e) => setResponsible(limpiarTexto(e.target.value, LIMITES.responsable.max))}
              placeholder="Nombre del supervisor a cargo" />
            {responsible.length > 0 && !responsableOk && (
              <div className="cell-sub" style={{ color: "var(--orange)", marginTop: 6 }}>
                Mínimo {LIMITES.responsable.min} caracteres.
              </div>
            )}
            <div className="field-label">Observaciones <span className="optional-tag">(opcional)</span></div>
            <textarea className="manage-input" style={{ width: "100%", minHeight: 70 }} value={notes}
              maxLength={LIMITES.notas.max}
              onChange={(e) => setNotes(e.target.value.slice(0, LIMITES.notas.max))}
              placeholder="Contexto de la ronda…" />
            {err && <div className="err-box" style={{ marginTop: 12 }}>{err}</div>}
            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }}
              disabled={!puedeEnviar} onClick={submit}>
              {busy ? "Iniciando…" : "Iniciar ronda"}
            </button>
          </div>
        </div>
      )}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
