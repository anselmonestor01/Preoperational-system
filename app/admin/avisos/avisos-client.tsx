"use client";

// Envío manual de los recordatorios de regreso.
//
// El enlace `wa.me` abre WhatsApp con el mensaje ya escrito: funciona desde el
// primer día, sin cuenta de empresa y sin costo. Cuando se configure el envío
// automático, esta pantalla queda como respaldo y como registro de lo enviado.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

export interface AvisoRow {
  id: string;
  destinatario: string;
  mensaje: string;
  estado: string;
  intentos: number;
  created_at: string;
  enviado_at: string | null;
  driver_id: string | null;
}

const ETIQUETA: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: "Pendiente", clase: "warn" },
  enviado: { texto: "Enviado", clase: "ok" },
  fallido: { texto: "Falló", clase: "bad" },
  sin_destino: { texto: "Sin WhatsApp", clase: "neutral" },
};

/** WhatsApp exige el número sin espacios ni símbolos. */
const soloDigitos = (v: string) => (v ?? "").replace(/\D+/g, "");

export default function AvisosClient({ rows }: { rows: AvisoRow[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const pendientes = rows.filter((r) => r.estado === "pendiente");
  const sinDestino = rows.filter((r) => r.estado === "sin_destino");

  async function marcarEnviado(a: AvisoRow) {
    setBusy(a.id);
    const { error } = await supabase
      .from("notifications")
      .update({ estado: "enviado", enviado_at: new Date().toISOString() })
      .eq("id", a.id);
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible marcar el aviso."));
    show("Aviso marcado como enviado");
    router.refresh();
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Recordatorios de regreso</div>
            <div className="panel-sub">
              {pendientes.length} por enviar · se generan solos cuando un vehículo sale autorizado.
            </div>
          </div>
        </div>

        {pendientes.length === 0 ? (
          <div className="empty-state">No hay recordatorios pendientes.</div>
        ) : (
          <div className="manage-list">
            {pendientes.map((a) => (
              <div key={a.id} className="manage-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <strong>{a.destinatario}</strong>
                  <span className="cell-sub">{fmtDateTime(a.created_at)}</span>
                </div>
                <div className="dialog-message" style={{ margin: 0, fontSize: 13 }}>{a.mensaje}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a
                    className="btn btn-primary btn-sm"
                    href={`https://wa.me/${soloDigitos(a.destinatario)}?text=${encodeURIComponent(a.mensaje)}`}
                    target="_blank" rel="noopener noreferrer"
                  >
                    Abrir en WhatsApp
                  </a>
                  <button className="btn btn-ghost btn-sm" disabled={busy === a.id} onClick={() => marcarEnviado(a)}>
                    Marcar como enviado
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {sinDestino.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Conductores sin WhatsApp registrado</div>
              <div className="panel-sub">
                {sinDestino.length} recordatorio(s) no se pueden enviar. Agrega el número en Conductores.
              </div>
            </div>
          </div>
          <div className="manage-list">
            {sinDestino.slice(0, 10).map((a) => (
              <div key={a.id} className="manage-row manage-row-sm">
                <div className="manage-row-main">{a.mensaje.slice(0, 80)}…</div>
                <span className="cell-sub">{fmtDateTime(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
              <thead><tr><th>Fecha</th><th>Destino</th><th>Estado</th><th>Enviado</th></tr></thead>
              <tbody>
                {rows.map((a) => {
                  const e = ETIQUETA[a.estado] ?? { texto: a.estado, clase: "neutral" };
                  return (
                    <tr key={a.id}>
                      <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.created_at)}</td>
                      <td>{a.destinatario || <span className="cell-sub">sin número</span>}</td>
                      <td><span className={"badge " + e.clase}>{e.texto}</span></td>
                      <td className="cell-sub">{a.enviado_at ? fmtDateTime(a.enviado_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-state">Todavía no se ha generado ningún aviso.</div>}
      </div>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
