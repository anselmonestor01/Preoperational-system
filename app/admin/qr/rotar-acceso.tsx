"use client";

// Generar o regenerar el código que abre el kiosco.
//
// Regenerar invalida el cartel anterior en el acto, así que se pide
// confirmación: quien lo pulse por error deja al patio sin acceso hasta que
// imprima y pegue el nuevo.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { useDialog } from "@/components/ui/dialogs";

export default function RotarAcceso({
  configurado, rotadoEn,
}: { configurado: boolean; rotadoEn: string | null }) {
  const supabase = createClient();
  const router = useRouter();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generar() {
    if (configurado) {
      const ok = await dialog.confirm({
        title: "Generar un código nuevo",
        message:
          "Los conductores no podrán entrar escaneando el cartel viejo. Tendrás que " +
          "imprimir y pegar el nuevo antes de que llegue el primer turno.",
        warning: "El cartel que esté pegado en la portería deja de funcionar en el acto.",
        confirmLabel: "Generar de todos modos",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(true); setError("");
    const { error } = await supabase.rpc("rotate_kiosk_access");
    setBusy(false);
    if (error) { setError(friendlyError(error, "No fue posible generar el acceso.")); return; }
    router.refresh();
  }

  return (
    <div style={{ marginTop: 16 }}>
      {error && <div className="err-box" style={{ marginBottom: 12 }}>{error}</div>}
      <button className={"btn " + (configurado ? "btn-ghost" : "btn-primary")} disabled={busy} onClick={generar}>
        {busy ? "Generando…" : configurado ? "Generar un código nuevo" : "Generar el código de acceso"}
      </button>
      {rotadoEn && (
        <div className="cell-sub" style={{ marginTop: 8 }}>
          Código actual generado el {rotadoEn}.
        </div>
      )}
    </div>
  );
}
