"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function RoundsClient({ hasOpen }: { hasOpen: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  async function startRound() {
    const label = window.prompt('Nombre de la nueva ronda (ej. "Turno tarde"). Vacío = automático.');
    if (label === null) return;
    if (hasOpen && !window.confirm("Iniciar una nueva ronda CERRARÁ la ronda vigente y reiniciará el tablero de vehículos disponibles. ¿Continuar?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("start_round", { p_label: label });
    setBusy(false);
    if (error) return show(error.message);
    show("Nueva ronda iniciada"); router.refresh();
  }
  async function closeRound() {
    if (!window.confirm("¿Cerrar la ronda vigente? No quedará ninguna ronda abierta hasta que inicie otra.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("close_round");
    setBusy(false);
    if (error) return show(error.message);
    show("Ronda cerrada"); router.refresh();
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={startRound}>Iniciar nueva ronda</button>
      {hasOpen && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={closeRound}>Cerrar ronda</button>}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </div>
  );
}
