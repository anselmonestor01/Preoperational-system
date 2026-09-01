"use client";

// Seguimiento de novedades: cambio de estado y visor de evidencia fotográfica.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import EvidenceGallery from "@/components/EvidenceGallery";

export interface IssueRow {
  id: string; item_name: string; category_key: string | null; severity: string;
  description: string | null; due_date: string | null; status: string; created_at: string;
  vehicle_id: string; inspection_id: string | null;
  vehicles: { plate: string } | null; drivers: { full_name: string } | null;
}

export default function IssuesClient({ issues, evidence }: { issues: IssueRow[]; evidence: Record<string, string[]> }) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };

  async function setStatus(iss: IssueRow, statusValue: string) {
    let note: string | null = null;
    if (statusValue === "resolved") { note = window.prompt("Nota de resolución (opcional):") ?? null; }
    setBusy(iss.id);
    const { error } = await supabase.rpc("set_issue_status", { p_issue_id: iss.id, p_status: statusValue, p_note: note });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible actualizar la novedad."));
    show("Novedad actualizada"); router.refresh();
  }

  if (!issues.length) {
    return (
      <div className="panel"><div className="stub">
        <div className="stub-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01M10.3 3.9 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h3>Sin novedades</h3>
        <p>No hay novedades con este filtro. Cuando un conductor marque un ítem como Regular, Malo, Incompleto o No tiene, aparecerá aquí con su detalle y evidencias.</p>
      </div></div>
    );
  }

  // Agrupar por vehículo.
  const groups: Record<string, { plate: string; driver: string; items: IssueRow[] }> = {};
  issues.forEach((i) => {
    const k = i.vehicle_id;
    if (!groups[k]) groups[k] = { plate: i.vehicles?.plate ?? "—", driver: i.drivers?.full_name ?? "", items: [] };
    groups[k].items.push(i);
  });

  const badge = (s: string) => {
    const map: Record<string, string> = { pending: "warn", review: "info", resolved: "ok", reopened: "bad" };
    const lbl: Record<string, string> = { pending: "Pendiente", review: "En revisión", resolved: "Resuelta", reopened: "Reabierta" };
    return <span className={"badge " + (map[s] ?? "neutral")}>{lbl[s] ?? s}</span>;
  };

  return (
    <div className="panel">
      <div className="panel-head"><div><div className="panel-title">Vehículos con novedades</div>
        <div className="panel-sub">{Object.keys(groups).length} vehículo(s) · {issues.length} novedad(es)</div></div></div>
      <div className="issue-card-list">
        {Object.values(groups).map((g, gi) => (
          <div key={gi} className="issue-card">
            <div className="issue-card-head">
              <div>
                <div className="issue-veh" style={{ fontSize: 14.5 }}>{g.plate} <span className="cell-sub" style={{ fontWeight: 500 }}>— {g.items.length} novedad(es)</span></div>
                {g.driver && <div className="cell-sub">{g.driver}</div>}
              </div>
            </div>
            <div className="issue-sub-list">
              {g.items.map((i) => (
                <div key={i.id} className="issue-sub-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="issue-sub-item">
                      {i.item_name} <span className={"badge " + (i.severity === "bad" ? "bad" : "warn")} style={{ fontSize: 10, marginLeft: 4 }}>{i.severity === "bad" ? "Malo" : "Regular"}</span>
                    </div>
                    <div className="issue-card-text" style={{ margin: "2px 0 6px" }}>
                      {i.description || "Sin detalle escrito"}{i.due_date ? <> · <b>Vence: {fmtDate(i.due_date)}</b></> : null}
                    </div>
                    <EvidenceGallery urls={evidence[i.id] ?? []} size={64} empty="Sin evidencia fotográfica" />
                  </div>
                  <div className="issue-sub-actions">
                    {badge(i.status)}
                    {i.status !== "resolved" ? (<>
                      <button className="btn btn-ghost btn-sm" disabled={busy === i.id || i.status === "review"} onClick={() => setStatus(i, "review")}>En revisión</button>
                      <button className="btn btn-primary btn-sm" disabled={busy === i.id} onClick={() => setStatus(i, "resolved")}>Resuelta</button>
                    </>) : (
                      <button className="btn btn-ghost btn-sm" disabled={busy === i.id} onClick={() => setStatus(i, "reopened")}>Reabrir</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </div>
  );
}
