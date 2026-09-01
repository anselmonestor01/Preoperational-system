"use client";

// Acciones de depuración sobre una ronda: renombrar y eliminar.
//
// Eliminar una ronda borra TODAS sus inspecciones y su rastro (respuestas,
// novedades y evidencias). Está pensado para limpiar datos de prueba, por eso
// exige la contraseña del administrador y queda registrado en la auditoría.
// Los archivos de Storage no se pueden borrar por SQL, así que el RPC devuelve
// sus rutas y se eliminan aquí con la sesión del propio administrador.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { useDialog } from "@/components/ui/dialogs";

export default function RoundActions({
  roundId, label, inspections,
}: { roundId: string; label: string; inspections: number }) {
  const supabase = createClient();
  const router = useRouter();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  async function rename() {
    const next = await dialog.prompt({
      title: "Renombrar ronda",
      message: "El nuevo nombre se refleja en el historial y en los reportes.",
      label: "Nombre de la ronda",
      defaultValue: label,
      placeholder: 'Ej. "Operación Cartagena — turno tarde"',
      required: true,
      confirmLabel: "Guardar nombre",
    });
    if (next === null || next.trim() === label) return;
    setBusy(true);
    const { error } = await supabase.rpc("rename_round", { p_round_id: roundId, p_label: next.trim() });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible renombrar la ronda."));
    show("Ronda renombrada"); router.refresh();
  }

  async function remove() {
    const password = await dialog.confirmWithPassword({
      title: `Eliminar "${label}"`,
      message: inspections > 0
        ? `Se eliminarán ${inspections} inspección(es) de esta ronda junto con sus novedades y evidencias fotográficas. El historial quedará como si la ronda nunca hubiera existido.`
        : "Esta ronda no tiene inspecciones. Se eliminará del historial.",
      warning: "Esta acción no se puede deshacer.",
      confirmLabel: "Eliminar ronda",
      tone: "danger",
    });
    if (password === null) return;

    setBusy(true);
    const { data, error } = await supabase.rpc("delete_round", { p_round_id: roundId, p_password: password });
    if (error) { setBusy(false); return show(friendlyError(error, "No fue posible eliminar la ronda.")); }

    // Borrado de los archivos de evidencia asociados (Storage no se toca por SQL).
    const paths: string[] = data?.storage_paths ?? [];
    if (paths.length) await supabase.storage.from("evidence").remove(paths);

    setBusy(false);
    show(`Ronda eliminada (${data?.inspections_deleted ?? 0} inspección(es))`);
    router.refresh();
  }

  return (
    <>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={rename}>Renombrar</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={remove}
          style={{ color: "var(--red)", borderColor: "rgba(198,66,60,.25)" }}>Eliminar</button>
      </div>
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
