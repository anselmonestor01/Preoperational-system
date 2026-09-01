"use client";

// Gestión de conductores: alta con PIN, foto de perfil y baja. El PIN se guarda
// cifrado y sólo un administrador puede revelarlo mediante un RPC auditado.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { compressImage, AVATAR_PRESET } from "@/lib/image";

export interface DriverRow {
  id: string; full_name: string; license: string | null; whatsapp: string | null;
  photo_path: string | null; active: boolean;
}

export default function DriversClient({ rows, photoMap, orgId }: { rows: DriverRow[]; photoMap: Record<string, string>; orgId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");
  const [edit, setEdit] = useState<DriverRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [pinFor, setPinFor] = useState<DriverRow | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };
  const list = rows.filter((d) => d.full_name.toLowerCase().includes(q.toLowerCase()));

  async function reveal(d: DriverRow) {
    if (revealed[d.id]) { setRevealed((r) => { const n = { ...r }; delete n[d.id]; return n; }); return; }
    setBusy(d.id);
    const { data, error } = await supabase.rpc("reveal_driver_pin", { p_driver_id: d.id });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible revelar el PIN."));
    if (!data?.has_pin) return show(`${d.full_name} no tiene PIN asignado.`);
    setRevealed((r) => ({ ...r, [d.id]: data.pin }));
  }
  async function toggleActive(d: DriverRow) {
    if (!window.confirm(`${d.active ? "Marcar inactivo" : "Marcar activo"} a ${d.full_name}?`)) return;
    setBusy(d.id);
    const { error } = await supabase.from("drivers").update({ active: !d.active }).eq("id", d.id);
    setBusy(null);
    if (error) return show(friendlyError(error));
    show("Conductor actualizado"); router.refresh();
  }
  async function del(d: DriverRow, mode: "archive" | "hard") {
    if (mode === "hard" && !window.confirm(`⚠ ELIMINAR DEFINITIVAMENTE a ${d.full_name}\n\nSe elimina su identidad operativa. El historial de inspecciones conserva su nombre. No se puede deshacer.\n\n¿Continuar?`)) return;
    if (mode === "archive" && !window.confirm(`¿Marcar inactivo a ${d.full_name}? No aparecerá para nuevas inspecciones; su historial se conserva.`)) return;
    setBusy(d.id);
    const { error } = await supabase.rpc("delete_driver", { p_driver_id: d.id, p_mode: mode });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible eliminar el conductor."));
    show(mode === "hard" ? `${d.full_name} eliminado` : `${d.full_name} inactivado`); router.refresh();
  }
  async function uploadPhoto(d: DriverRow, file: File) {
    setBusy(d.id);
    // Se reescala a tamaño de avatar antes de subir; además el nombre queda
    // siempre .jpg, así reemplazar la foto sobrescribe el mismo objeto y no
    // deja archivos huérfanos en Storage.
    const photo = await compressImage(file, AVATAR_PRESET);
    const path = `${orgId}/drivers/${d.id}.jpg`;
    const up = await supabase.storage
      .from("driver-photos")
      .upload(path, photo, { upsert: true, contentType: photo.type });
    if (up.error) { setBusy(null); return show(friendlyError(up.error, "No fue posible subir la foto.")); }
    const { error } = await supabase.from("drivers").update({ photo_path: path }).eq("id", d.id);
    setBusy(null);
    if (error) return show(friendlyError(error));
    show(`Foto de ${d.full_name} actualizada`); router.refresh();
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div><div className="panel-title">Conductores habilitados</div>
            <div className="panel-sub">{rows.length} conductor(es) — cada uno confirma su identidad con su PIN. Los inactivos conservan su historial.</div></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="manage-input" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 180 }} />
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Nuevo conductor</button>
          </div>
        </div>

        <div className="manage-list">
          {list.map((d) => {
            const photo = d.photo_path ? photoMap[d.photo_path] : null;
            return (
              <div key={d.id} className="manage-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div className="manage-row-main" style={{ flex: "1 1 200px" }}>
                    <span className="manage-avatar" style={{ overflow: "hidden", padding: 0, width: 34, height: 34 }}>
                      {photo ? <img src={photo} alt="" className="drv-photo" /> : initials(d.full_name)}
                    </span>
                    <span>{d.full_name}</span>
                    {d.active ? <span className="badge ok" style={{ marginLeft: 6 }}>Activo</span> : <span className="badge bad" style={{ marginLeft: 6 }}>Inactivo</span>}
                    <span className="badge info" style={{ marginLeft: 6, fontFamily: "monospace", letterSpacing: 1 }}>
                      PIN {revealed[d.id] ?? "••••"}
                    </span>
                    <button className="btn btn-ghost btn-sm" disabled={busy === d.id} onClick={() => reveal(d)}>{revealed[d.id] ? "Ocultar" : "Mostrar PIN"}</button>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="manage-remove" title="Marcar inactivo" onClick={() => del(d, "archive")}>⧉</button>
                    <button className="manage-remove" title="Eliminar definitivamente" onClick={() => del(d, "hard")}>✕</button>
                  </div>
                </div>
                <div className="cell-sub">Licencia N.º: {d.license ? d.license : <span style={{ color: "var(--orange)" }}>sin registrar</span>}</div>
                <div className="cell-sub">WhatsApp: {d.whatsapp ? d.whatsapp : <span style={{ color: "var(--orange)" }}>sin registrar</span>}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEdit(d)}>Editar datos</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPinFor(d)}>Cambiar PIN</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy === d.id} onClick={() => fileRefs.current[d.id]?.click()}>Foto</button>
                  <input ref={(el) => { fileRefs.current[d.id] = el; }} type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(d, f); e.target.value = ""; }} />
                  <button className="btn btn-ghost btn-sm" disabled={busy === d.id} onClick={() => toggleActive(d)}>{d.active ? "Marcar inactivo" : "Marcar activo"}</button>
                </div>
              </div>
            );
          })}
          {list.length === 0 && <div className="empty-state">No hay conductores que coincidan.</div>}
        </div>
      </div>

      {(edit || creating) && <DriverForm driver={edit} onClose={() => { setEdit(null); setCreating(false); }} onSaved={(m) => { show(m); router.refresh(); }} />}
      {pinFor && <PinForm driver={pinFor} onClose={() => setPinFor(null)} onSaved={show} />}
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}

function DriverForm({ driver, onClose, onSaved }: { driver: DriverRow | null; onClose: () => void; onSaved: (m: string) => void }) {
  const supabase = createClient();
  const [f, setF] = useState({ full_name: driver?.full_name ?? "", license: driver?.license ?? "", whatsapp: driver?.whatsapp ?? "", pin: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    let error;
    if (driver) ({ error } = await supabase.from("drivers").update({ full_name: f.full_name, license: f.license, whatsapp: f.whatsapp }).eq("id", driver.id));
    else {
      if (f.pin && !/^\d{4}$/.test(f.pin)) { setErr("El PIN debe tener 4 dígitos."); setBusy(false); return; }
      ({ error } = await supabase.rpc("admin_create_driver", { p_full_name: f.full_name, p_license: f.license, p_whatsapp: f.whatsapp, p_pin: f.pin || null }));
    }
    setBusy(false);
    if (error) return setErr(friendlyError(error, "No fue posible guardar el conductor."));
    onSaved(driver ? "Conductor actualizado" : "Conductor creado"); onClose();
  }

  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 420 }}>
        <div className="sheet-head"><div className="sheet-title">{driver ? "Editar conductor" : "Nuevo conductor"}</div>
          <button className="sheet-close" onClick={onClose}>✕</button></div>
        <div className="field-label">Nombre completo</div>
        <input className="manage-input" style={{ width: "100%" }} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        <div className="field-label">Licencia N.º</div>
        <input className="manage-input" style={{ width: "100%" }} value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })} />
        <div className="field-label">WhatsApp <span className="optional-tag">(ej. +57 300 1234567)</span></div>
        <input className="manage-input" style={{ width: "100%" }} value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} />
        {!driver && (<>
          <div className="field-label">PIN de 4 dígitos <span className="optional-tag">(opcional; se genera si se deja vacío)</span></div>
          <input className="manage-input" style={{ width: "100%" }} inputMode="numeric" maxLength={4} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/[^\d]/g, "") })} />
        </>)}
        {err && <div className="err-box" style={{ marginTop: 12 }}>{err}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy || !f.full_name} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}

function PinForm({ driver, onClose, onSaved }: { driver: DriverRow; onClose: () => void; onSaved: (m: string) => void }) {
  const supabase = createClient();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  function randomPin() { return String(Math.floor(1000 + Math.random() * 9000)); }
  async function save(value: string) {
    if (!/^\d{4}$/.test(value)) { setErr("El PIN debe tener 4 dígitos."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("set_driver_pin", { p_driver_id: driver.id, p_pin: value });
    setBusy(false);
    if (error) return setErr(friendlyError(error));
    onSaved(`PIN de ${driver.full_name} actualizado`); onClose();
  }
  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" style={{ maxWidth: 380 }}>
        <div className="sheet-head"><div><div className="sheet-title">Cambiar PIN</div><div className="cell-sub">{driver.full_name}</div></div>
          <button className="sheet-close" onClick={onClose}>✕</button></div>
        <div className="field-label">Nuevo PIN de 4 dígitos</div>
        <input className="pin-input" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, ""))} autoFocus />
        {err && <div className="err-box" style={{ marginTop: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary btn-block" disabled={busy || pin.length < 4} onClick={() => save(pin)}>{busy ? "Guardando…" : "Guardar PIN"}</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => { const p = randomPin(); setPin(p); save(p); }}>Generar</button>
        </div>
      </div>
    </div>
  );
}
