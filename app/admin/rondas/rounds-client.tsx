"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function RoundsClient({ hasOpen }: { hasOpen: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(false);
  const [label, setLabel] = useState("");
  const [responsible, setResponsible] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");

  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3200);
  };

  function openModal() {
    setLabel("");
    setResponsible("");
    setNotes("");
    setErr("");
    setModal(true);
  }

  async function startRound() {
    setErr("");
    if (hasOpen) {
      const ok = window.confirm(
        "Iniciar una nueva ronda CERRARÁ la ronda vigente y reiniciará el tablero de vehículos disponibles para inspección. ¿Continuar?",
      );
      if (!ok) return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("start_round", {
      p_label: label.trim() || null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message || "No se pudo iniciar la ronda");
      show(error.message || "Error al iniciar ronda");
      return;
    }
    setModal(false);
    const name = (data as any)?.label ?? label.trim() ?? "Nueva ronda";
    show(`Ronda iniciada: ${name}`);
    router.refresh();
  }

  async function closeRound() {
    if (
      !window.confirm(
        "¿Cerrar la ronda vigente? El kiosco quedará bloqueado hasta que inicie otra ronda.",
      )
    )
      return;
    setBusy(true);
    const { error } = await supabase.rpc("close_round");
    setBusy(false);
    if (error) {
      show(error.message || "No se pudo cerrar la ronda");
      return;
    }
    show("Ronda cerrada. Inicie una nueva cuando esté listo.");
    router.refresh();
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={openModal}>
          {hasOpen ? "Iniciar nueva ronda" : "Abrir ronda"}
        </button>
        {hasOpen && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={closeRound}>
            Cerrar ronda
          </button>
        )}
      </div>

      {modal && (
        <div
          className="overlay show"
          style={{ alignItems: "center", zIndex: 100 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(false);
          }}
        >
          <div className="sheet" style={{ maxWidth: 440, borderRadius: 18, margin: 16 }}>
            <div className="sheet-head">
              <div>
                <div className="sheet-title">
                  {hasOpen ? "Nueva ronda" : "Abrir ronda de inspección"}
                </div>
                <div className="sheet-tag" style={{ color: "var(--muted)", textTransform: "none" }}>
                  {hasOpen
                    ? "Se cerrará la ronda actual y se liberarán los vehículos para nueva inspección"
                    : "El kiosco de conductores solo funciona con una ronda abierta"}
                </div>
              </div>
              <button
                type="button"
                className="sheet-close"
                disabled={busy}
                onClick={() => setModal(false)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <div className="form-group" style={{ marginTop: 8 }}>
              <label htmlFor="round-label">Nombre de la ronda</label>
              <input
                id="round-label"
                className="input"
                placeholder='Ej. "Turno mañana", "Turno tarde", "Ronda 3"'
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
                disabled={busy}
              />
              <div className="cell-sub" style={{ marginTop: 6 }}>
                Si lo deja vacío se generará automáticamente (Ronda N).
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="round-resp">Responsable (opcional)</label>
              <input
                id="round-resp"
                className="input"
                placeholder="Nombre del supervisor o encargado"
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
                disabled={busy}
              />
            </div>

            <div className="form-group">
              <label htmlFor="round-notes">Observación (opcional)</label>
              <textarea
                id="round-notes"
                className="input"
                placeholder="Notas de esta ronda…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={busy}
                rows={2}
              />
            </div>

            {err && (
              <div className="error-box" style={{ marginTop: 12 }}>
                {err}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => setModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={startRound}
              >
                {busy ? "Iniciando…" : "Iniciar ronda"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
