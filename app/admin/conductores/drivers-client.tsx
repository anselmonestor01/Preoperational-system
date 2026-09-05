"use client";

// Gestión de conductores: alta con PIN, foto de perfil y baja. El PIN se guarda
// cifrado y sólo un administrador puede revelarlo mediante un RPC auditado.
//
// A ESCALA
// Con más de cincuenta conductores hacían falta tres cosas. Primero, ESTADO
// OPERATIVO: quién está fuera, quién ya cumplió su turno y quién puede salir,
// con la explicación delante para que nadie tenga que adivinar por qué el
// sistema bloquea a alguien. Segundo, un BUSCADOR CON SUGERENCIAS, porque un
// campo de texto a secas exige recordar el nombre exacto. Y tercero,
// PAGINACIÓN: mil filas en una sola lista no se navegan, se sufren.

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { initials, fmtDateTime } from "@/lib/format";
import { nombresRepetidos, distintivo } from "@/lib/homonimos";
import { horasDesde, antiguedad } from "@/lib/urgencia";
import { friendlyError } from "@/lib/errors";
import { compressImage, AVATAR_PRESET } from "@/lib/image";
import { useDialog } from "@/components/ui/dialogs";
import PhotoCropper from "@/components/PhotoCropper";
import { LIMITES, WHATSAPP_DIGITOS, limpiarTexto, soloTelefono, soloDigitos, textoValido, telefonoValido, licenciaValida } from "@/lib/validation";

export interface DriverRow {
  id: string; full_name: string; license: string | null; whatsapp: string | null;
  photo_path: string | null; active: boolean;
}

type EnRuta = Record<string, { placa: string; desde: string | null }>;
type YaOperaron = Record<string, { placa: string; autorizada: boolean | null }>;
type Filtro = "todos" | "disponibles" | "operacion" | "operaron" | "inactivos";

const POR_PAGINA = 20;

export default function DriversClient({
  rows, photoMap, orgId, enRuta, yaOperaron, rondaLabel,
}: {
  rows: DriverRow[]; photoMap: Record<string, string>; orgId: string;
  enRuta: EnRuta; yaOperaron: YaOperaron; rondaLabel: string | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const dialog = useDialog();
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");
  const [edit, setEdit] = useState<DriverRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [pinFor, setPinFor] = useState<DriverRow | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Foto elegida pendiente de encuadrar. Se sube sólo tras confirmar el recorte.
  const [recorte, setRecorte] = useState<{ driver: DriverRow; archivo: File } | null>(null);

  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [pagina, setPagina] = useState(1);
  const [sugiriendo, setSugiriendo] = useState(false);

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };

  /** El estado operativo de un conductor, tal y como lo aplica la base. */
  function estadoDe(d: DriverRow) {
    if (!d.active) return "inactivos" as const;
    if (enRuta[d.id]) return "operacion" as const;
    if (yaOperaron[d.id]) return "operaron" as const;
    return "disponibles" as const;
  }

  const grupos: Record<Filtro, (d: DriverRow) => boolean> = {
    todos: () => true,
    disponibles: (d) => estadoDe(d) === "disponibles",
    operacion: (d) => estadoDe(d) === "operacion",
    operaron: (d) => estadoDe(d) === "operaron",
    inactivos: (d) => !d.active,
  };
  const cuenta = (f: Filtro) => rows.filter(grupos[f]).length;

  const CHIPS: { id: Filtro; texto: string; tono?: string }[] = [
    { id: "todos", texto: "Toda la plantilla" },
    { id: "disponibles", texto: "Disponibles", tono: "ok" },
    { id: "operacion", texto: "En operación" },
    { id: "operaron", texto: "Ya operaron" , tono: "warn" },
    { id: "inactivos", texto: "Inactivos" },
  ];

  // Dos conductores homónimos son normales en una plantilla grande; sin nada
  // que los distinga, el administrador no sabe a cuál está editando.
  const homonimos = useMemo(() => nombresRepetidos(rows), [rows]);

  const filtrados = useMemo(
    () => rows.filter(grupos[filtro]).filter((d) => d.full_name.toLowerCase().includes(q.toLowerCase())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filtro, q, enRuta, yaOperaron]);

  /** Sugerencias mientras se escribe: convierte «me suena que era Rodríguez»
   *  en un clic, en vez de exigir el nombre exacto. */
  const sugerencias = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return rows.filter((d) => d.full_name.toLowerCase().includes(t)).slice(0, 8);
  }, [rows, q]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const list = filtrados.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA);

  function cambiarFiltro(f: Filtro) { setFiltro(f); setPagina(1); }
  function cambiarBusqueda(v: string) { setQ(v); setPagina(1); setSugiriendo(true); }

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
    const ok = await dialog.confirm({
      title: d.active ? "Marcar inactivo" : "Reactivar conductor",
      message: d.active
        ? `${d.full_name} dejará de aparecer para nuevas inspecciones. Su historial se conserva.`
        : `${d.full_name} volverá a estar disponible para realizar inspecciones.`,
      confirmLabel: d.active ? "Marcar inactivo" : "Reactivar",
    });
    if (!ok) return;
    setBusy(d.id);
    const { error } = await supabase.from("drivers").update({ active: !d.active }).eq("id", d.id);
    setBusy(null);
    if (error) return show(friendlyError(error));
    show("Conductor actualizado"); router.refresh();
  }
  async function del(d: DriverRow, mode: "archive" | "hard") {
    if (mode === "hard") {
      const ok = await dialog.confirm({
        title: `Eliminar a ${d.full_name}`,
        message: "Se elimina su identidad operativa. El historial de inspecciones conserva su nombre.",
        warning: "Esta acción no se puede deshacer.",
        confirmLabel: "Eliminar definitivamente",
        tone: "danger",
      });
      if (!ok) return;
    } else {
      const ok = await dialog.confirm({
        title: "Marcar inactivo",
        message: `${d.full_name} no aparecerá para nuevas inspecciones; su historial se conserva.`,
        confirmLabel: "Marcar inactivo",
      });
      if (!ok) return;
    }
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
            <div className="panel-sub">
              {rows.length} conductor(es) — cada uno confirma su identidad con su PIN.
              {rondaLabel ? ` Ronda vigente: ${rondaLabel}.` : " Sin ronda abierta."}
            </div></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div className="buscador" style={{ width: 200 }}>
              <input className="manage-input" placeholder="Buscar por nombre…" value={q}
                style={{ width: "100%" }}
                onChange={(e) => cambiarBusqueda(e.target.value)}
                onFocus={() => setSugiriendo(true)}
                onBlur={() => setTimeout(() => setSugiriendo(false), 140)} />
              {sugiriendo && sugerencias.length > 0 && q.trim().length >= 2 && (
                <div className="sugerencias">
                  {sugerencias.map((d) => {
                    const e = estadoDe(d);
                    return (
                      <button key={d.id} className="sugerencia"
                        onMouseDown={(ev) => { ev.preventDefault(); setQ(d.full_name); setSugiriendo(false); setPagina(1); }}>
                        <span className="manage-avatar" style={{ width: 26, height: 26, padding: 0, fontSize: 10 }}>
                          {initials(d.full_name)}
                        </span>
                        <span>{d.full_name}</span>
                        <span className="sugerencia-sub">
                          {distintivo(d, homonimos) ? distintivo(d, homonimos) + " · " : ""}
                          {e === "operacion" ? "en ruta" : e === "operaron" ? "ya operó" : e === "inactivos" ? "inactivo" : "disponible"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Nuevo conductor</button>
          </div>
        </div>

        <div className="filtros-rapidos" style={{ marginBottom: 8 }}>
          {CHIPS.map((c) => (
            <button key={c.id}
              className={"chip-filtro " + (c.tono ? "tono-" + c.tono + " " : "") + (filtro === c.id ? "activo" : "")}
              onClick={() => cambiarFiltro(c.id)}>
              {c.texto}<span className="chip-num">{cuenta(c.id)}</span>
            </button>
          ))}
        </div>
        <div className="cell-sub" style={{ marginBottom: 14 }}>
          Quien está <b>en operación</b> tiene un vehículo fuera sin registrar el regreso, y quien
          <b> ya operó</b> cumplió su turno en la ronda vigente. Ninguno de los dos puede iniciar
          otra inspección: la regla la impone la base de datos, aquí sólo se muestra.
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
                    {distintivo(d, homonimos) && (
                      <span className="badge neutral" style={{ marginLeft: 6, fontWeight: 600 }}>
                        {distintivo(d, homonimos)}
                      </span>
                    )}
                    {!d.active ? <span className="badge bad" style={{ marginLeft: 6 }}>Inactivo</span>
                      : enRuta[d.id] ? <span className="badge info" style={{ marginLeft: 6 }}>En operación</span>
                      : yaOperaron[d.id] ? <span className="badge warn" style={{ marginLeft: 6 }}>Ya operó</span>
                      : <span className="badge ok" style={{ marginLeft: 6 }}>Disponible</span>}
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
                {enRuta[d.id] && (
                  <div className="cell-sub" style={{ color: "var(--blue)" }}>
                    Salió con <b>{enRuta[d.id].placa}</b> {antiguedad(horasDesde(enRuta[d.id].desde))}
                    {enRuta[d.id].desde ? ` (${fmtDateTime(enRuta[d.id].desde)})` : ""} y no ha
                    registrado el regreso. No puede iniciar otra inspección hasta cerrarla.
                  </div>
                )}
                {!enRuta[d.id] && yaOperaron[d.id] && (
                  <div className="cell-sub" style={{ color: "var(--orange)" }}>
                    Ya cumplió su turno en esta ronda con <b>{yaOperaron[d.id].placa}</b>
                    {yaOperaron[d.id].autorizada === false ? " (no autorizada)" : ""}.
                    Podrá volver a operar cuando se abra la ronda siguiente.
                  </div>
                )}
                <div className="cell-sub">Licencia N.º: {d.license ? d.license : <span style={{ color: "var(--orange)" }}>sin registrar</span>}</div>
                <div className="cell-sub">WhatsApp: {d.whatsapp ? d.whatsapp : <span style={{ color: "var(--orange)" }}>sin registrar</span>}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEdit(d)}>Editar datos</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPinFor(d)}>Cambiar PIN</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy === d.id} onClick={() => fileRefs.current[d.id]?.click()}>Foto</button>
                  <input ref={(el) => { fileRefs.current[d.id] = el; }} type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setRecorte({ driver: d, archivo: f }); e.target.value = ""; }} />
                  <button className="btn btn-ghost btn-sm" disabled={busy === d.id} onClick={() => toggleActive(d)}>{d.active ? "Marcar inactivo" : "Marcar activo"}</button>
                </div>
              </div>
            );
          })}
          {list.length === 0 && (
            <div className="empty-state">
              {filtro === "todos" && !q
                ? "Todavía no hay conductores registrados."
                : `Ningún conductor coincide${q ? ` con «${q}»` : ""}${filtro !== "todos" ? ` en «${CHIPS.find((c) => c.id === filtro)?.texto}»` : ""}.`}
            </div>
          )}
        </div>

        {totalPaginas > 1 && (
          <div className="paginacion">
            <div className="cell-sub">
              {filtrados.length} conductor(es) · página {paginaSegura} de {totalPaginas}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost btn-sm" disabled={paginaSegura <= 1}
                onClick={() => setPagina(paginaSegura - 1)}>← Anterior</button>
              <button className="btn btn-ghost btn-sm" disabled={paginaSegura >= totalPaginas}
                onClick={() => setPagina(paginaSegura + 1)}>Siguiente →</button>
            </div>
          </div>
        )}
      </div>

      {(edit || creating) && <DriverForm driver={edit} onClose={() => { setEdit(null); setCreating(false); }} onSaved={(m) => { show(m); router.refresh(); }} />}
      {pinFor && <PinForm driver={pinFor} onClose={() => setPinFor(null)} onSaved={show} />}
      {recorte && (
        <PhotoCropper
          archivo={recorte.archivo}
          onCancelar={() => setRecorte(null)}
          onListo={(recortada) => {
            const d = recorte.driver;
            setRecorte(null);
            uploadPhoto(d, recortada);
          }}
        />
      )}

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
    if (driver) {
      ({ error } = await supabase.from("drivers")
        .update({ full_name: f.full_name, license: f.license })
        .eq("id", driver.id));

      // El WhatsApp va por su propio RPC porque cambiarlo no es sólo cambiar un
      // campo: también repunta los avisos que siguen en cola hacia el número
      // nuevo. Con un UPDATE directo, un aviso creado cuando el conductor no
      // tenía número quedaba inservible para siempre.
      if (!error && soloDigitos(f.whatsapp) !== soloDigitos(driver.whatsapp ?? "")) {
        ({ error } = await supabase.rpc("set_driver_whatsapp", {
          p_driver_id: driver.id, p_whatsapp: f.whatsapp,
        }));
      }
    } else {
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
        <input className="manage-input" style={{ width: "100%" }} value={f.full_name}
          maxLength={LIMITES.nombreConductor.max}
          onChange={(e) => setF({ ...f, full_name: limpiarTexto(e.target.value, LIMITES.nombreConductor.max) })} />
        {f.full_name.length > 0 && !textoValido(f.full_name, LIMITES.nombreConductor) && (
          <div className="cell-sub" style={{ color: "var(--orange)", marginTop: 4 }}>
            Mínimo {LIMITES.nombreConductor.min} caracteres.
          </div>
        )}
        <div className="field-label">Licencia N.º</div>
        <input className="manage-input" style={{ width: "100%" }} value={f.license}
          inputMode="numeric" maxLength={LIMITES.licencia.max}
          onChange={(e) => setF({ ...f, license: e.target.value.replace(/[^\w-]/g, "").slice(0, LIMITES.licencia.max) })} />
        {f.license.length > 0 && !licenciaValida(f.license) && (
          <div className="cell-sub" style={{ color: "var(--orange)", marginTop: 4 }}>
            Entre {LIMITES.licencia.min} y {LIMITES.licencia.max} caracteres.
          </div>
        )}
        <div className="field-label">WhatsApp <span className="optional-tag">(ej. +57 300 1234567)</span></div>
        <input className="manage-input" style={{ width: "100%" }} value={f.whatsapp}
          inputMode="tel" maxLength={LIMITES.whatsapp.max}
          onChange={(e) => setF({ ...f, whatsapp: soloTelefono(e.target.value).slice(0, LIMITES.whatsapp.max) })} />
        {f.whatsapp.length > 0 && !telefonoValido(f.whatsapp) && (
          <div className="cell-sub" style={{ color: "var(--orange)", marginTop: 4 }}>
            Teléfono incompleto (entre {WHATSAPP_DIGITOS.min} y {WHATSAPP_DIGITOS.max} dígitos).
          </div>
        )}
        {!driver && (<>
          <div className="field-label">PIN de 4 dígitos <span className="optional-tag">(opcional; se genera si se deja vacío)</span></div>
          <input className="manage-input" style={{ width: "100%" }} inputMode="numeric" maxLength={4} value={f.pin} onChange={(e) => setF({ ...f, pin: soloDigitos(e.target.value) })} />
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
        <input className="pin-input" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(soloDigitos(e.target.value))} autoFocus />
        {err && <div className="err-box" style={{ marginTop: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary btn-block" disabled={busy || pin.length < 4} onClick={() => save(pin)}>{busy ? "Guardando…" : "Guardar PIN"}</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => { const p = randomPin(); setPin(p); save(p); }}>Generar</button>
        </div>
      </div>
    </div>
  );
}
