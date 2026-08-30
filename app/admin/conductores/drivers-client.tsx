"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/format";
import type { Driver } from "@/lib/types";

export default function DriversClient({ initial }: { initial: Driver[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");
  const [edit, setEdit] = useState<Driver | null>(null);
  const [creating, setCreating] = useState(false);
  const [pinFor, setPinFor] = useState<Driver | null>(null);

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };
  const list = initial.filter((d) => d.full_name.toLowerCase().includes(q.toLowerCase()));

  async function toggleActive(d: Driver) {
    if (!window.confirm(`${d.active ? "Desactivar" : "Activar"} a ${d.full_name}?`)) return;
    const { error } = await supabase.from("drivers").update({ active: !d.active }).eq("id", d.id);
    if (error) return show(error.message);
    show("Conductor actualizado"); router.refresh();
  }

  return (
    <>
      <div className="toolbar">
        <input className="input" placeholder="Buscar conductor…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Nuevo conductor</button>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Conductor</th><th>Licencia</th><th>WhatsApp</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td><div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div className="pick-avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{initials(d.full_name)}</div>
                  <span style={{ fontWeight: 700 }}>{d.full_name}</span></div></td>
                <td>{d.license || "—"}</td>
                <td>{d.whatsapp || "—"}</td>
                <td>{d.active ? <span className="badge ok">Activo</span> : <span className="badge neutral">Inactivo</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEdit(d)}>Editar</button>{" "}
                  <button className="btn btn-ghost btn-sm" onClick={() => setPinFor(d)}>PIN</button>{" "}
                  <button className={"btn btn-sm " + (d.active ? "btn-danger" : "btn-success")} onClick={() => toggleActive(d)}>
                    {d.active ? "Desactivar" : "Activar"}</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5}><div className="stub"><p>Sin conductores.</p></div></td></tr>}
          </tbody>
        </table>
      </div>

      {(edit || creating) && <DriverForm driver={edit} onClose={() => { setEdit(null); setCreating(false); }} onSaved={(m) => { show(m); router.refresh(); }} />}
      {pinFor && <PinForm driver={pinFor} onClose={() => setPinFor(null)} onSaved={(m) => { show(m); }} />}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}

function DriverForm({ driver, onClose, onSaved }: { driver: Driver | null; onClose: () => void; onSaved: (m: string) => void }) {
  const supabase = createClient();
  const [f, setF] = useState({ full_name: driver?.full_name ?? "", license: driver?.license ?? "", whatsapp: driver?.whatsapp ?? "", pin: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    let error;
    if (driver) {
      ({ error } = await supabase.from("drivers").update({ full_name: f.full_name, license: f.license, whatsapp: f.whatsapp }).eq("id", driver.id));
    } else {
      if (f.pin && !/^\d{4}$/.test(f.pin)) { setErr("El PIN debe tener 4 dígitos."); setBusy(false); return; }
      ({ error } = await supabase.rpc("admin_create_driver", {
        p_full_name: f.full_name, p_license: f.license, p_whatsapp: f.whatsapp, p_pin: f.pin || null,
      }));
    }
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved(driver ? "Conductor actualizado" : "Conductor creado"); onClose();
  }

  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 420 }}>
        <div className="sheet-head"><div className="sheet-title">{driver ? "Editar conductor" : "Nuevo conductor"}</div>
          <button className="sheet-close" onClick={onClose}>✕</button></div>
        <div className="field-label">Nombre completo</div>
        <input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        <div className="field-label">Licencia</div>
        <input className="input" value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })} />
        <div className="field-label">WhatsApp <span className="optional-tag">(+57…)</span></div>
        <input className="input" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} />
        {!driver && (<>
          <div className="field-label">PIN de 4 dígitos <span className="optional-tag">(opcional)</span></div>
          <input className="input" inputMode="numeric" maxLength={4} value={f.pin}
            onChange={(e) => setF({ ...f, pin: e.target.value.replace(/[^\d]/g, "") })} />
        </>)}
        {err && <div className="error-box" style={{ marginTop: 12 }}>{err}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy || !f.full_name} onClick={save}>
          {busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

function PinForm({ driver, onClose, onSaved }: { driver: Driver; onClose: () => void; onSaved: (m: string) => void }) {
  const supabase = createClient();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (!/^\d{4}$/.test(pin)) { setErr("El PIN debe tener 4 dígitos."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("set_driver_pin", { p_driver_id: driver.id, p_pin: pin });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved(`PIN actualizado para ${driver.full_name}`); onClose();
  }
  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 360 }}>
        <div className="sheet-head"><div><div className="sheet-title">Cambiar PIN</div><div className="cell-sub">{driver.full_name}</div></div>
          <button className="sheet-close" onClick={onClose}>✕</button></div>
        <div className="field-label">Nuevo PIN de 4 dígitos</div>
        <input className="pin-input" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, ""))} autoFocus />
        {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} disabled={busy || pin.length < 4} onClick={save}>
          {busy ? "Guardando…" : "Guardar PIN"}</button>
      </div>
    </div>
  );
}
