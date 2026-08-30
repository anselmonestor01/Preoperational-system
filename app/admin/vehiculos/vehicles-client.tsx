"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import type { Vehicle } from "@/lib/types";

type V = Vehicle;

export default function VehiclesClient({ initial, openBy }: { initial: V[]; openBy: Record<string, number> }) {
  const supabase = createClient();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [edit, setEdit] = useState<V | null>(null);
  const [creating, setCreating] = useState(false);

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };
  const list = initial.filter((v) => v.plate.toLowerCase().includes(q.toLowerCase()));

  async function archiveVehicle(v: V) {
    if (!window.confirm(`¿Retirar el vehículo ${v.plate} de la flota activa?\n\nLas inspecciones históricas se conservan. El vehículo dejará de aparecer en el kiosco.`)) return;
    setBusy(true);
    const { error } = await supabase.from("vehicles").update({ status: "archived", admin_blocked: true, admin_block_reason: "Retirado de la flota" }).eq("id", v.id);
    setBusy(false);
    if (error) return show(error.message);
    show(`${v.plate} retirado de la flota`);
    router.refresh();
  }

  async function toggleBlock(v: V) {
    let reason = "";
    if (!v.admin_blocked) {
      reason = window.prompt("Motivo del bloqueo:") ?? "";
      if (!reason.trim()) return;
    } else if (!window.confirm(`¿Desbloquear ${v.plate}?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_vehicle_block", {
      p_vehicle_id: v.id, p_blocked: !v.admin_blocked, p_reason: reason,
    });
    setBusy(false);
    if (error) return show(error.message);
    show(v.admin_blocked ? `${v.plate} desbloqueado` : `${v.plate} bloqueado`);
    router.refresh();
  }

  return (
    <>
      <div className="toolbar">
        <input className="input" placeholder="Buscar por placa…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nuevo vehículo</button>
      </div>

      <div className="tbl-wrap">
        <table className="data-table">
          <thead><tr><th>Placa</th><th>Modelo</th><th>Estado</th><th>Documentos</th><th>Novedades</th><th></th></tr></thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id}>
                <td style={{ fontWeight: 700 }}>{v.plate}<div className="cell-sub">{v.reference}</div></td>
                <td>{v.model || "—"}</td>
                <td>
                  {v.admin_blocked
                    ? <span className="badge bad" title={v.admin_block_reason ?? ""}>Bloqueado</span>
                    : v.status !== "active" ? <span className="badge neutral">{v.status}</span>
                    : <span className="badge ok">Activo</span>}
                  {v.admin_blocked && v.admin_block_reason && <div className="cell-sub" style={{ maxWidth: 220 }}>{v.admin_block_reason}</div>}
                </td>
                <td className="cell-sub">
                  Seguro: {fmtDate(v.insurance_expires)}<br />Gases: {fmtDate(v.emissions_expires)}
                </td>
                <td>{openBy[v.id] ? <span className="badge warn">{openBy[v.id]} abierta(s)</span> : <span className="cell-sub">—</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEdit(v)}>Editar</button>{" "}
                  <button className={"btn btn-sm " + (v.admin_blocked ? "btn-success" : "btn-danger")} disabled={busy} onClick={() => toggleBlock(v)}>
                    {v.admin_blocked ? "Desbloquear" : "Bloquear"}
                  </button>{" "}
                  {v.status === "active" && (
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => archiveVehicle(v)} title="Retirar de la flota">
                      Eliminar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6}><div className="stub"><p>Sin vehículos.</p></div></td></tr>}
          </tbody>
        </table>
      </div>

      {(edit || creating) && (
        <VehicleForm vehicle={edit} onClose={() => { setEdit(null); setCreating(false); }} onSaved={(m) => { show(m); router.refresh(); }} />
      )}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}

function VehicleForm({ vehicle, onClose, onSaved }: { vehicle: V | null; onClose: () => void; onSaved: (m: string) => void }) {
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
    if (error) { setErr(error.message); return; }
    onSaved(vehicle ? "Vehículo actualizado" : "Vehículo creado");
    onClose();
  }

  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 440 }}>
        <div className="sheet-head"><div className="sheet-title">{vehicle ? "Editar vehículo" : "Nuevo vehículo"}</div>
          <button className="sheet-close" onClick={onClose}>✕</button></div>
        <div className="field-label">Placa</div>
        <input className="input" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} disabled={!!vehicle} />
        <div className="field-label">Referencia</div>
        <input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        <div className="field-label">Modelo</div>
        <input className="input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="Ej. 2019" />
        <div className="field-label">Tarjeta de operación</div>
        <input className="input" value={f.operation_card} onChange={(e) => setF({ ...f, operation_card: e.target.value })} />
        <div className="field-label">Vencimiento del seguro</div>
        <input type="date" className="input" value={f.insurance_expires ?? ""} onChange={(e) => setF({ ...f, insurance_expires: e.target.value })} />
        <div className="field-label">Vencimiento emisión de gases</div>
        <input type="date" className="input" value={f.emissions_expires ?? ""} onChange={(e) => setF({ ...f, emissions_expires: e.target.value })} />
        <div className="field-label">Último cambio de aceite</div>
        <input type="date" className="input" value={f.oil_change_date ?? ""} onChange={(e) => setF({ ...f, oil_change_date: e.target.value })} />
        {err && <div className="error-box" style={{ marginTop: 12 }}>{err}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy || !f.plate} onClick={save}>
          {busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}
