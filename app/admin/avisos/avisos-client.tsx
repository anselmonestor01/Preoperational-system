"use client";

// Panel de avisos de WhatsApp.
//
// Todo lo que se ve aquí sale de la tabla `notifications`, la misma cola que
// usa el envío automático. Enviar desde aquí no es un atajo: deja el mismo
// registro (quién, a qué número, con qué texto y cuándo), que es lo que una
// empresa necesita para responder por lo que se le comunicó a un conductor.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { useDialog } from "@/components/ui/dialogs";
import { LIMITES, WHATSAPP_DIGITOS, soloTelefono, telefonoValido } from "@/lib/validation";

export interface AvisoRow {
  id: string;
  destinatario: string;
  mensaje: string;
  estado: string;
  tipo: string;
  intentos: number;
  created_at: string;
  enviado_at: string | null;
  driver_id: string | null;
  inspection_id: string | null;
}

export interface ConductorRow {
  id: string;
  full_name: string;
  whatsapp: string | null;
  active: boolean;
  en_ruta: { placa: string; desde: string } | null;
}

const ETIQUETA: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: "Por enviar", clase: "warn" },
  enviado: { texto: "Enviado", clase: "ok" },
  fallido: { texto: "Falló", clase: "bad" },
  sin_destino: { texto: "Sin WhatsApp", clase: "neutral" },
};

/** WhatsApp exige el número sin espacios ni símbolos. */
const soloDigitos = (v: string) => (v ?? "").replace(/\D+/g, "");

/** Límites que también valida el servidor; aquí sólo evitan un viaje inútil. */
const MSG_MIN = 5;
const MSG_MAX = 900;

/**
 * Textos de arranque para los avisos más frecuentes del patio. No son
 * plantillas de Meta: son atajos de escritura, el administrador puede
 * cambiar cualquier palabra antes de enviar.
 */
const PLANTILLAS: Array<{ nombre: string; texto: (nombre: string, placa: string) => string }> = [
  {
    nombre: "Recordar regreso",
    texto: (n, p) =>
      `🤗 Hola ${n}, no olvides registrar tu REGRESO con ${p || "el vehículo"} al llegar. ` +
      `Sin ese registro el vehículo sigue figurando en ruta y no queda disponible para el siguiente turno. ¡Gracias!`,
  },
  {
    nombre: "Pasar a mantenimiento",
    texto: (n, p) =>
      `Hola ${n}. Antes de tu próxima salida pasa ${p || "el vehículo"} por el taller: ` +
      `hay una novedad pendiente por revisar. Avísanos cuando lo dejes.`,
  },
  {
    nombre: "Documentos por vencer",
    texto: (n) =>
      `Hola ${n}, tienes documentación próxima a vencer. Acércate a la oficina para actualizarla ` +
      `y evitar quedar fuera de servicio.`,
  },
  {
    nombre: "Vehículo bloqueado",
    texto: (n, p) =>
      `Hola ${n}. ${p || "El vehículo"} quedó BLOQUEADO por una falla de seguridad y no puede salir. ` +
      `Comunícate con el supervisor antes de moverlo.`,
  },
];

export default function AvisosClient({
  rows, conductores,
}: { rows: AvisoRow[]; conductores: ConductorRow[] }) {
  const supabase = createClient();
  const router = useRouter();
  const dialog = useDialog();

  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const [destino, setDestino] = useState("");
  const [texto, setTexto] = useState("");

  const pendientes = useMemo(() => rows.filter((r) => r.estado === "pendiente"), [rows]);
  const sinDestino = useMemo(() => rows.filter((r) => r.estado === "sin_destino"), [rows]);
  const fallidos = useMemo(() => rows.filter((r) => r.estado === "fallido"), [rows]);
  const sinWhatsApp = useMemo(
    () => conductores.filter((c) => !soloDigitos(c.whatsapp ?? "")), [conductores]);

  const elegido = conductores.find((c) => c.id === destino) ?? null;
  const telElegido = soloDigitos(elegido?.whatsapp ?? "");
  const largo = texto.trim().length;
  const puedeEnviar = !!elegido && largo >= MSG_MIN && largo <= MSG_MAX && !busy;

  /** Abre WhatsApp con el mensaje ya escrito. */
  function abrirWhatsApp(numero: string, mensaje: string) {
    const url = `https://wa.me/${soloDigitos(numero)}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function aplicarPlantilla(i: number) {
    const nombre = (elegido?.full_name ?? "").trim().split(/\s+/)[0] || "conductor";
    setTexto(PLANTILLAS[i].texto(nombre, elegido?.en_ruta?.placa ?? ""));
  }

  /** Registra el mensaje en la cola y abre WhatsApp con el texto listo. */
  async function enviarPersonalizado() {
    if (!elegido) return;
    setBusy("nuevo");
    const { data, error } = await supabase.rpc("send_custom_message", {
      p_driver_id: elegido.id, p_mensaje: texto.trim(),
    });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible registrar el mensaje."));

    const r = data as { destinatario?: string; mensaje?: string; con_destino?: boolean };
    if (r?.con_destino && r.destinatario) {
      abrirWhatsApp(r.destinatario, r.mensaje ?? texto.trim());
      show("Mensaje registrado. Se abrió WhatsApp para enviarlo.");
    } else {
      show("Mensaje guardado, pero el conductor no tiene WhatsApp registrado.");
    }
    setTexto("");
    router.refresh();
  }

  /** Cambia el número del conductor y repunta sus avisos todavía en cola. */
  async function cambiarWhatsApp(c: ConductorRow) {
    const actual = soloDigitos(c.whatsapp ?? "");
    const nuevo = await dialog.prompt({
      title: `WhatsApp de ${c.full_name}`,
      message: c.en_ruta
        ? `Está en ruta con ${c.en_ruta.placa}. Cambiar el número ahora también corrige los avisos que aún no se han enviado.`
        : "Los avisos que todavía estén en cola se enviarán al número nuevo.",
      label: "Número con indicativo de país",
      defaultValue: actual,
      placeholder: "573011987446",
      required: true,
      inputMode: "tel",
      maxLength: LIMITES.whatsapp.max,
      sanitize: soloTelefono,
      validate: (v) => (telefonoValido(v) && soloDigitos(v).length >= WHATSAPP_DIGITOS.min
        ? null
        : `Debe tener entre ${WHATSAPP_DIGITOS.min} y ${WHATSAPP_DIGITOS.max} dígitos, con el indicativo del país.`),
      confirmLabel: "Guardar número",
    });
    if (nuevo === null || soloDigitos(nuevo) === actual) return;

    setBusy(c.id);
    const { data, error } = await supabase.rpc("set_driver_whatsapp", {
      p_driver_id: c.id, p_whatsapp: nuevo,
    });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible cambiar el número."));

    const reparados = (data as { avisos_reparados?: number })?.avisos_reparados ?? 0;
    show(reparados > 0
      ? `Número actualizado. ${reparados} aviso(s) en cola quedaron listos para enviar.`
      : "Número actualizado.");
    router.refresh();
  }

  async function marcarEnviado(a: AvisoRow) {
    setBusy(a.id);
    const { error } = await supabase.rpc("mark_notification_sent", { p_id: a.id });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible marcar el aviso."));
    show("Aviso marcado como enviado");
    router.refresh();
  }

  async function descartar(a: AvisoRow) {
    const ok = await dialog.confirm({
      title: "Descartar aviso",
      message: "El aviso saldrá de la cola y no se enviará. El historial conserva el registro de los ya enviados.",
      confirmLabel: "Descartar",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(a.id);
    const { error } = await supabase.rpc("discard_notification", { p_id: a.id });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible descartar el aviso."));
    show("Aviso descartado");
    router.refresh();
  }

  const enCola = [...pendientes, ...fallidos];

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Redactar un mensaje                                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Escribir a un conductor</div>
            <div className="panel-sub">
              El mensaje queda registrado en el sistema y se abre WhatsApp con el texto listo.
            </div>
          </div>
        </div>

        <div className="wa-composer">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="wa-conductor">Conductor</label>
            <select
              id="wa-conductor" className="manage-input" style={{ width: "100%" }}
              value={destino} onChange={(e) => setDestino(e.target.value)}
            >
              <option value="">Selecciona un conductor…</option>
              {conductores.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                  {c.en_ruta ? ` — en ruta con ${c.en_ruta.placa}` : ""}
                  {soloDigitos(c.whatsapp ?? "") ? "" : " (sin WhatsApp)"}
                </option>
              ))}
            </select>
          </div>

          {elegido && (
            <div className="wa-destino">
              <div>
                <span className="wa-destino-label">Se enviará a</span>
                <strong>{telElegido ? `+${telElegido}` : "— sin número registrado —"}</strong>
                {elegido.en_ruta && (
                  <div className="cell-sub">
                    En ruta con {elegido.en_ruta.placa} desde {fmtDateTime(elegido.en_ruta.desde)}
                  </div>
                )}
              </div>
              <button className="btn btn-ghost btn-sm" disabled={busy === elegido.id}
                onClick={() => cambiarWhatsApp(elegido)}>
                {telElegido ? "Cambiar número" : "Agregar número"}
              </button>
            </div>
          )}

          <div className="wa-templates">
            {PLANTILLAS.map((p, i) => (
              <button key={p.nombre} type="button" className="wa-chip"
                disabled={!elegido} onClick={() => aplicarPlantilla(i)}>
                {p.nombre}
              </button>
            ))}
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="wa-texto">Mensaje</label>
            <textarea
              id="wa-texto" rows={5} maxLength={MSG_MAX} value={texto}
              placeholder="Escribe aquí, o toca una de las frases de arriba para empezar."
              onChange={(e) => setTexto(e.target.value.slice(0, MSG_MAX))}
            />
            <div className="wa-counter">
              <span className={largo > 0 && largo < MSG_MIN ? "is-short" : ""}>
                {largo} / {MSG_MAX}
                {largo > 0 && largo < MSG_MIN ? ` · mínimo ${MSG_MIN} caracteres` : ""}
              </span>
            </div>
          </div>

          <button className="btn btn-primary" disabled={!puedeEnviar} onClick={enviarPersonalizado}>
            {busy === "nuevo" ? "Registrando…" : "Registrar y abrir WhatsApp"}
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Cola de envío                                                    */}
      {/* ---------------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Por enviar</div>
            <div className="panel-sub">
              {enCola.length === 0
                ? "Nada en cola."
                : `${enCola.length} mensaje(s) esperando salir.`}
            </div>
          </div>
        </div>

        {enCola.length === 0 ? (
          <div className="empty-state">
            <strong>No hay nada pendiente por enviar.</strong>
            <span>
              Los recordatorios de regreso se crean solos cuando un vehículo sale autorizado.
              Si todavía no ha salido ninguno hoy, esta lista estará vacía: es lo normal.
              Para escribirle a alguien ahora mismo, usa el bloque de arriba.
            </span>
          </div>
        ) : (
          <div className="manage-list">
            {enCola.map((a) => (
              <div key={a.id} className="wa-row">
                <div className="wa-row-head">
                  <strong>+{soloDigitos(a.destinatario)}</strong>
                  <span className="cell-sub">
                    <span className={"badge " + (a.tipo === "personalizado" ? "neutral" : "info")}>
                      {a.tipo === "personalizado" ? "Escrito por un admin" : "Recordatorio automático"}
                    </span>
                    {" "}{fmtDateTime(a.created_at)}
                  </span>
                </div>
                <div className="wa-preview">{a.mensaje}</div>
                {a.intentos > 0 && (
                  <div className="cell-sub" style={{ color: "var(--red)" }}>
                    {a.intentos} intento(s) automático(s) sin éxito. Envíalo desde aquí.
                  </div>
                )}
                <div className="wa-row-actions">
                  <button className="btn btn-primary btn-sm"
                    onClick={() => abrirWhatsApp(a.destinatario, a.mensaje)}>
                    Abrir en WhatsApp
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={busy === a.id}
                    onClick={() => marcarEnviado(a)}>
                    Marcar como enviado
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={busy === a.id}
                    style={{ color: "var(--red)", borderColor: "rgba(198,66,60,.25)" }}
                    onClick={() => descartar(a)}>
                    Descartar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Conductores sin número                                           */}
      {/* ---------------------------------------------------------------- */}
      {(sinWhatsApp.length > 0 || sinDestino.length > 0) && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Conductores sin WhatsApp</div>
              <div className="panel-sub">
                {sinDestino.length > 0
                  ? `${sinDestino.length} aviso(s) no se pudieron encolar por falta de número. Al agregarlo se reparan solos.`
                  : "Sin número no se les puede avisar nada."}
              </div>
            </div>
          </div>
          <div className="manage-list">
            {sinWhatsApp.map((c) => (
              <div key={c.id} className="manage-row manage-row-sm">
                <div className="manage-row-main">
                  {c.full_name}
                  {c.en_ruta && <span className="badge warn">En ruta · {c.en_ruta.placa}</span>}
                </div>
                <button className="btn btn-ghost btn-sm" disabled={busy === c.id}
                  onClick={() => cambiarWhatsApp(c)}>
                  Agregar número
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Historial                                                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Historial</div>
            <div className="panel-sub">Últimos {rows.length} avisos generados.</div>
          </div>
        </div>
        {rows.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr><th>Fecha</th><th>Destino</th><th>Origen</th><th>Mensaje</th><th>Estado</th><th>Enviado</th></tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const e = ETIQUETA[a.estado] ?? { texto: a.estado, clase: "neutral" };
                  return (
                    <tr key={a.id}>
                      <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.created_at)}</td>
                      <td>{a.destinatario ? `+${soloDigitos(a.destinatario)}` : <span className="cell-sub">sin número</span>}</td>
                      <td className="cell-sub">{a.tipo === "personalizado" ? "Manual" : "Automático"}</td>
                      <td className="cell-sub wa-cell-msg" title={a.mensaje}>{a.mensaje}</td>
                      <td><span className={"badge " + e.clase}>{e.texto}</span></td>
                      <td className="cell-sub">{a.enviado_at ? fmtDateTime(a.enviado_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>Todavía no se ha generado ningún aviso.</strong>
            <span>Aquí quedará el registro de todo lo que se le escriba a un conductor.</span>
          </div>
        )}
      </div>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
