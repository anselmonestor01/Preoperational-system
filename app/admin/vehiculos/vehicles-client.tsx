"use client";

// Gestión de vehículos: alta, bloqueo/desbloqueo, liberación de novedades y
// baja (archivar o eliminar). Las transiciones críticas van por RPC.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

export interface VehicleRow {
  id: string; plate: string; reference: string | null; model: string | null;
  operation_card: string | null; insurance_expires: string | null; emissions_expires: string | null;
  oil_change_date: string | null; status: string; admin_blocked: boolean; admin_block_reason: string | null;
  availability: string; open_issue_count: number; current_round_inspection_id: string | null;
}

const AVAIL: Record<string, { cls: string; dot: string; label: string }> = {
  available: { cls: "ok", dot: "ok", label: "Disponible" },
  admin_blocked: { cls: "bad", dot: "bad", label: "Bloqueado (admin)" },
  issues: { cls: "warn", dot: "warn", label: "Con novedades" },
  inspected: { cls: "info", dot: "warn", label: "Ya inspeccionado" },
  out_of_service: { cls: "neutral", dot: "off", label: "Fuera de servicio" },
  archived: { cls: "neutral", dot: "off", label: "Archivado" },
};

export default function VehiclesClient({ rows, opsBy, roundLabel }: { rows: VehicleRow[]; opsBy: Record<string, number>; roundLabel: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [edit, setEdit] = useState<VehicleRow | null>(null);
  const [creating, setCreating] = useState(false);

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };
  const active = rows.filter((v) => v.status !== "archived");
  const archived = rows.filter((v) => v.status === "archived");
  const list = active.filter((v) => v.plate.toLowerCase().includes(q.toLowerCase()));
  const blockedCount = active.filter((v) => v.availability !== "available").length;

  async function block(v: VehicleRow) {
    const reason = window.prompt(`Motivo del bloqueo administrativo de ${v.plate}:`);
    if (reason === null) return;
    if (!reason.trim()) return show("Indica el motivo del bloqueo.");
    setBusy(v.id);
    const { error } = await supabase.rpc("set_vehicle_block", { p_vehicle_id: v.id, p_blocked: true, p_reason: reason.trim() });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible bloquear el vehículo."));
    show(`${v.plate} bloqueado correctamente`); router.refresh();
  }
  async function unblock(v: VehicleRow) {
    setBusy(v.id);
    const { error } = await supabase.rpc("set_vehicle_block", { p_vehicle_id: v.id, p_blocked: false, p_reason: "" });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible desbloquear el vehículo."));
    show(`${v.plate} desbloqueado`); router.refresh();
  }
  async function release(v: VehicleRow) {
    if (!v.current_round_inspection_id) return;
    if (!window.confirm(`¿Liberar ${v.plate} para una nueva inspección en la ronda? La inspección actual se conserva en el historial.`)) return;
    setBusy(v.id);
    const { error } = await supabase.rpc("release_inspection", { p_inspection_id: v.current_round_inspection_id });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible liberar el vehículo."));
    show(`${v.plate} liberado`); router.refresh();
  }
  async function resolveAll(v: VehicleRow) {
    if (!window.confirm(`¿Marcar como resueltas todas las novedades de ${v.plate} y liberarlo?`)) return;
    setBusy(v.id);
    const { data: iss } = await supabase.from("issues").select("id").eq("vehicle_id", v.id).neq("status", "resolved");
    for (const i of iss ?? []) {
      const { error } = await supabase.rpc("set_issue_status", { p_issue_id: i.id, p_status: "resolved", p_note: "Resuelta desde gestión de flota" });
      if (error) { setBusy(null); return show(friendlyError(error)); }
    }
    if (v.current_round_inspection_id) await supabase.rpc("release_inspection", { p_inspection_id: v.current_round_inspection_id });
    setBusy(null);
    show(`${v.plate}: novedades resueltas`); router.refresh();
  }
  async function reactivate(v: VehicleRow) {
    setBusy(v.id);
    const { error } = await supabase.from("vehicles").update({ status: "active" }).eq("id", v.id);
    setBusy(null);
    if (error) return show(friendlyError(error));
    show(`${v.plate} reintegrado a la flota`); router.refresh();
  }
  async function del(v: VehicleRow, mode: "archive" | "hard") {
    if (mode === "hard" && !window.confirm(`⚠ ELIMINAR DEFINITIVAMENTE ${v.plate}\n\nSe borrará el vehículo y TODO su historial (inspecciones, novedades, evidencias). Esta acción NO se puede deshacer.\n\n¿Continuar?`)) return;
    if (mode === "archive" && !window.confirm(`¿Archivar ${v.plate}? Deja de operar pero conserva su historial. Podrás reintegrarlo luego.`)) return;
    setBusy(v.id);
    const { error } = await supabase.rpc("delete_vehicle", { p_vehicle_id: v.id, p_mode: mode });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible eliminar el vehículo."));
    show(mode === "hard" ? `${v.plate} eliminado definitivamente` : `${v.plate} archivado`); router.refresh();
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div><div className="panel-title">Flota registrada</div>
            <div className="panel-sub">{active.length} vehículo(s) · {blockedCount} no disponible(s) · ronda {roundLabel}</div></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="manage-input" placeholder="Buscar placa…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 180 }} />
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Nuevo vehículo</button>
          </div>
        </div>

        <div className="manage-list">
          {list.map((v) => {
            const a = AVAIL[v.availability] ?? AVAIL.available;
            const docs = [v.model && `Modelo ${v.model}`, v.operation_card && `T.Op. ${v.operation_card}`, v.insurance_expires && `Seguro ${fmtDate(v.insurance_expires)}`].filter(Boolean).join(" · ");
            return (
              <div key={v.id} className="manage-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div className="manage-row-main" style={{ flex: "1 1 200px" }}>
                    <span className={"veh-dot " + a.dot} />
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><path d="M15 10h3.3a1 1 0 0 1 .85.47L21 14v3h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    <span>{v.plate}</span>
                    <span className={"badge " + a.cls} style={{ marginLeft: 6 }}>{a.label}</span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="manage-remove" title="Archivar" onClick={() => del(v, "archive")}>⧉</button>
                    <button className="manage-remove" title="Eliminar definitivamente" onClick={() => del(v, "hard")}>✕</button>
                  </div>
                </div>
                {docs && <div className="cell-sub">{docs}</div>}
                {v.availability === "admin_blocked" && v.admin_block_reason && <div className="cell-sub" style={{ color: "var(--red)" }}>{v.admin_block_reason}</div>}
                {v.availability === "issues" && <div className="cell-sub" style={{ color: "var(--orange)" }}>{v.open_issue_count} novedad(es) sin resolver</div>}
                {opsBy[v.id] ? <div className="cell-sub" style={{ color: "var(--orange)", fontWeight: 600 }}>{opsBy[v.id]} operación(es) abierta(s) sin registrar regreso</div> : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEdit(v)}>Datos del vehículo</button>
                  {v.availability === "out_of_service"
                    ? <button className="btn btn-primary btn-sm" disabled={busy === v.id} onClick={() => reactivate(v)}>Reactivar</button>
                    : v.admin_blocked
                      ? <button className="btn btn-primary btn-sm" disabled={busy === v.id} onClick={() => unblock(v)}>Desbloquear</button>
                      : <button className="btn btn-ghost btn-sm" disabled={busy === v.id} onClick={() => block(v)}>Bloquear</button>}
                  {v.availability === "issues" && <button className="btn btn-primary btn-sm" disabled={busy === v.id} onClick={() => resolveAll(v)}>Resolver y liberar</button>}
                  {v.availability === "inspected" && <button className="btn btn-ghost btn-sm" disabled={busy === v.id} onClick={() => release(v)}>Liberar para nueva inspección</button>}
                </div>
              </div>
            );
          })}
          {list.length === 0 && <div className="empty-state">No hay vehículos que coincidan.</div>}
        </div>
      </div>

      {archived.length > 0 && (
        <div className="panel" style={{ marginTop: 18 }}>
          <div className="panel-head"><div><div className="panel-title">Vehículos archivados</div><div className="panel-sub">{archived.length} vehículo(s) · su historial se conserva</div></div></div>
          <div className="manage-list">
            {archived.map((v) => (
              <div key={v.id} className="manage-row manage-row-sm">
                <div className="manage-row-main"><span className="veh-dot off" /><span>{v.plate}</span></div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" disabled={busy === v.id} onClick={() => reactivate(v)}>Reintegrar</button>
                  <button className="btn btn-danger btn-sm" disabled={busy === v.id} onClick={() => del(v, "hard")}>Eliminar def.</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(edit || creating) && <VehicleForm vehicle={edit} onClose={() => { setEdit(null); setCreating(false); }} onSaved={(m) => { show(m); router.refresh(); }} />}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}

function VehicleForm({ vehicle, onClose, onSaved }: { vehicle: VehicleRow | null; onClose: () => void; onSaved: (m: string) => void }) {
  const supabase = createClient();
  const [f, setF] = useState({
    plate: vehicle?.plate ?? "", reference: vehicle?.reference ?? "Camión de carga", model: vehicle?.model ?? "",
    operation_card: vehicle?.operation_card ?? "", insurance_expires: vehicle?.insurance_expires ?? "",
    emissions_expires: vehicle?.emissions_expires ?? "", oil_change_date: vehicle?.oil_change_date ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    const payload: any = { ...f };
    ["insurance_expires", "emissions_expires", "oil_change_date"].forEach((k) => { if (!payload[k]) payload[k] = null; });
    let error;
    if (vehicle) ({ error } = await supabase.from("vehicles").update(payload).eq("id", vehicle.id));
    else {
      const { data: org } = await supabase.from("organizations").select("id").maybeSingle();
      ({ error } = await supabase.from("vehicles").insert({ ...payload, organization_id: org?.id }));
    }
    setBusy(false);
    if (error) return setErr(friendlyError(error, "No fue posible guardar el vehículo."));
    onSaved(vehicle ? "Vehículo actualizado" : "Vehículo creado"); onClose();
  }

  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 440 }}>
        <div className="sheet-head"><div className="sheet-title">{vehicle ? `Datos de ${vehicle.plate}` : "Nuevo vehículo"}</div>
          <button className="sheet-close" onClick={onClose}>✕</button></div>
        <div className="field-label">Placa</div>
        <input className="manage-input" style={{ width: "100%" }} value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} disabled={!!vehicle} placeholder="ABC-123" />
        <div className="field-label">Referencia</div>
        <input className="manage-input" style={{ width: "100%" }} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        <div className="field-label">Modelo</div>
        <input className="manage-input" style={{ width: "100%" }} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="Ej. 2019" />
        <div className="field-label">Tarjeta de operación</div>
        <input className="manage-input" style={{ width: "100%" }} value={f.operation_card} onChange={(e) => setF({ ...f, operation_card: e.target.value })} />
        <div className="field-label">Vencimiento del seguro</div>
        <input type="date" className="manage-input" style={{ width: "100%" }} value={f.insurance_expires ?? ""} onChange={(e) => setF({ ...f, insurance_expires: e.target.value })} />
        <div className="field-label">Vencimiento emisión de gases</div>
        <input type="date" className="manage-input" style={{ width: "100%" }} value={f.emissions_expires ?? ""} onChange={(e) => setF({ ...f, emissions_expires: e.target.value })} />
        <div className="field-label">Último cambio de aceite</div>
        <input type="date" className="manage-input" style={{ width: "100%" }} value={f.oil_change_date ?? ""} onChange={(e) => setF({ ...f, oil_change_date: e.target.value })} />
        {err && <div className="err-box" style={{ marginTop: 12 }}>{err}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy || !f.plate} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}
