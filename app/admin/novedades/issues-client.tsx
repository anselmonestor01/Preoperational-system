"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";

type Iss = {
  id: string; item_name: string; category_key: string | null; severity: string;
  description: string | null; due_date: string | null; status: string; created_at: string;
  resolution_note: string | null; vehicle_id: string; vehicles: { plate: string } | null;
};

export default function IssuesClient({ initial }: { initial: Iss[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  async function setStatus(iss: Iss, status: string) {
    let note: string | null = iss.resolution_note ?? null;
    if (status === "resolved") { note = window.prompt("Nota de resolución (opcional):") ?? note; }
    setBusy(iss.id);
    const { error } = await supabase.rpc("set_issue_status", { p_issue_id: iss.id, p_status: status, p_note: note });
    setBusy(null);
    if (error) return show(error.message);
    show("Novedad actualizada"); router.refresh();
  }

  const badge = (s: string) => {
    const map: Record<string, string> = { pending: "warn", review: "info", resolved: "ok", reopened: "bad" };
    const lbl: Record<string, string> = { pending: "Pendiente", review: "En revisión", resolved: "Resuelta", reopened: "Reabierta" };
    return <span className={"badge " + (map[s] ?? "neutral")}>{lbl[s] ?? s}</span>;
  };

  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Vehículo</th><th>Novedad</th><th>Severidad</th><th>Estado</th><th>Reportada</th><th></th></tr></thead>
          <tbody>
            {initial.map((i) => (
              <tr key={i.id}>
                <td style={{ fontWeight: 700 }}>{i.vehicles?.plate ?? "—"}</td>
                <td>{i.item_name}<div className="cell-sub" style={{ maxWidth: 280 }}>{i.description || "Sin detalle"}</div></td>
                <td><span className={"badge " + (i.severity === "bad" ? "bad" : "warn")}>{i.severity === "bad" ? "Grave" : "Leve"}</span></td>
                <td>{badge(i.status)}</td>
                <td className="cell-sub">{fmtDate(i.created_at)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {i.status !== "resolved" ? (<>
                    {i.status !== "review" && <button className="btn btn-ghost btn-sm" disabled={busy === i.id} onClick={() => setStatus(i, "review")}>Revisión</button>}{" "}
                    <button className="btn btn-success btn-sm" disabled={busy === i.id} onClick={() => setStatus(i, "resolved")}>Resolver</button>
                  </>) : (
                    <button className="btn btn-ghost btn-sm" disabled={busy === i.id} onClick={() => setStatus(i, "reopened")}>Reabrir</button>
                  )}
                </td>
              </tr>
            ))}
            {initial.length === 0 && <tr><td colSpan={6}><div className="stub"><p>Sin novedades con este filtro. 🎉</p></div></td></tr>}
          </tbody>
        </table>
      </div>
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
