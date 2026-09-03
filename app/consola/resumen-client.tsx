"use client";

// Panorama de todas las empresas de la plataforma.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

export interface FilaPlataforma {
  organization_id: string;
  nombre: string;
  plan: string;
  billing_status: string;
  billing_note: string | null;
  creada: string;
  vehiculos: number;
  conductores: number;
  usuarios: number;
  inspecciones_7d: number;
  inspecciones_30d: number;
  inspecciones_total: number;
  ultima_actividad: string | null;
  vehiculos_bloqueados: number;
  novedades_pendientes: number;
  avisos_en_cola: number;
  evidencias: number;
  ronda_abierta: boolean;
}

const PLANES = ["demo", "basico", "profesional", "grupo"];
const ESTADOS: Record<string, { texto: string; clase: string }> = {
  al_dia:     { texto: "Al día",     clase: "ok" },
  pendiente:  { texto: "Pendiente",  clase: "warn" },
  suspendido: { texto: "Suspendido", clase: "bad" },
};

/** Días transcurridos desde una fecha, o null si nunca hubo actividad. */
function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function ResumenClient({
  filas, errorLectura,
}: { filas: FilaPlataforma[]; errorLectura: string | null }) {
  const supabase = createClient();
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [plan, setPlan] = useState("demo");
  const [estado, setEstado] = useState("al_dia");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const total = useMemo(() => ({
    empresas: filas.length,
    vehiculos: filas.reduce((n, f) => n + f.vehiculos, 0),
    conductores: filas.reduce((n, f) => n + f.conductores, 0),
    inspecciones30: filas.reduce((n, f) => n + f.inspecciones_30d, 0),
    evidencias: filas.reduce((n, f) => n + f.evidencias, 0),
  }), [filas]);

  // Empresas que merecen una llamada: sin actividad reciente, con la cola de
  // avisos atascada, o sin el pago al día. Es la parte que evita enterarse
  // cuando el cliente ya canceló.
  const atencion = useMemo(() => filas.filter((f) => {
    const d = diasDesde(f.ultima_actividad);
    return d === null || d > 7 || f.avisos_en_cola > 10 || f.billing_status !== "al_dia";
  }), [filas]);

  function abrirEdicion(f: FilaPlataforma) {
    setEditando(f.organization_id);
    setPlan(f.plan);
    setEstado(f.billing_status);
  }

  async function guardar(f: FilaPlataforma) {
    setBusy(true);
    const { error } = await supabase.rpc("set_organization_billing", {
      p_org_id: f.organization_id,
      p_plan: plan,
      p_status: estado,
      p_note: f.billing_note,
    });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible actualizar el plan."));
    setEditando(null);
    show(`Plan de ${f.nombre} actualizado`);
    router.refresh();
  }

  return (
    <>
      <h1 className="c-titulo">Resumen de la plataforma</h1>
      <p className="c-sub">
        Todas las empresas que usan el sistema. Sólo conteos y fechas: esta
        pantalla no puede mostrar placas, conductores ni fotos de nadie.
      </p>

      {errorLectura && (
        <div className="c-error">
          <strong>No se pudo cargar el panorama.</strong> {errorLectura}
        </div>
      )}

      <div className="c-cifras">
        <div className="c-cifra"><b>{total.empresas}</b><span>Empresas</span></div>
        <div className="c-cifra"><b>{total.vehiculos}</b><span>Vehículos</span></div>
        <div className="c-cifra"><b>{total.conductores}</b><span>Conductores</span></div>
        <div className="c-cifra"><b>{total.inspecciones30}</b><span>Inspecciones 30 d</span></div>
        <div className="c-cifra"><b>{total.evidencias}</b><span>Evidencias</span></div>
      </div>

      {atencion.length > 0 && (
        <div className="c-bloque">
          <div className="c-bloque-head alerta">
            <div>
              <div className="c-bloque-titulo">Requieren atención</div>
              <div className="c-bloque-sub">
                Sin actividad en más de 7 días, con la cola de avisos atascada, o con el pago pendiente.
              </div>
            </div>
            <span className="c-pill warn">{atencion.length}</span>
          </div>
          <div className="c-scroll">
            <table className="c-tabla">
              <tbody>
                {atencion.map((f) => {
                  const d = diasDesde(f.ultima_actividad);
                  return (
                    <tr key={f.organization_id}>
                      <td><strong>{f.nombre}</strong></td>
                      <td className="c-menor">
                        {d === null ? "nunca ha registrado una inspección"
                          : d > 7 ? `sin actividad hace ${d} días`
                          : f.avisos_en_cola > 10 ? `${f.avisos_en_cola} avisos atascados`
                          : "pago pendiente"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {f.billing_status !== "al_dia" && (
                          <span className={"c-pill " + (ESTADOS[f.billing_status]?.clase ?? "")}>
                            {ESTADOS[f.billing_status]?.texto ?? f.billing_status}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="c-bloque">
        <div className="c-bloque-head">
          <div>
            <div className="c-bloque-titulo">Todas las empresas</div>
            <div className="c-bloque-sub">{filas.length} en la plataforma.</div>
          </div>
        </div>
        <div className="c-scroll">
          <table className="c-tabla">
            <thead>
              <tr>
                <th>Empresa</th><th>Plan</th><th>Flota</th><th>Usuarios</th>
                <th>7 d</th><th>30 d</th><th>Actividad</th><th>Pendientes</th><th />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const d = diasDesde(f.ultima_actividad);
                const e = ESTADOS[f.billing_status] ?? { texto: f.billing_status, clase: "" };
                const abierto = editando === f.organization_id;
                return (
                  <tr key={f.organization_id}>
                    <td>
                      <strong>{f.nombre}</strong>
                      <div className="c-menor">
                        {f.ronda_abierta ? "ronda abierta" : "sin ronda abierta"} · desde {fmtDateTime(f.creada)}
                      </div>
                    </td>
                    <td>
                      {abierto ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
                          <select className="c-input" value={plan} onChange={(ev) => setPlan(ev.target.value)}>
                            {PLANES.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                          <select className="c-input" value={estado} onChange={(ev) => setEstado(ev.target.value)}>
                            {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
                          </select>
                        </div>
                      ) : (
                        <>
                          <span className="c-pill">{f.plan}</span>
                          <div style={{ marginTop: 5 }}>
                            <span className={"c-pill " + e.clase}>{e.texto}</span>
                          </div>
                        </>
                      )}
                    </td>
                    <td className="c-menor">{f.vehiculos} veh · {f.conductores} cond</td>
                    <td className="c-num">{f.usuarios}</td>
                    <td className="c-num"><strong>{f.inspecciones_7d}</strong></td>
                    <td className="c-num c-menor">{f.inspecciones_30d}</td>
                    <td className="c-menor" style={{ whiteSpace: "nowrap" }}>
                      {d === null ? "—" : d === 0 ? "hoy" : `hace ${d} d`}
                    </td>
                    <td className="c-menor">
                      {f.novedades_pendientes > 0 && <>{f.novedades_pendientes} novedades<br /></>}
                      {f.vehiculos_bloqueados > 0 && <>{f.vehiculos_bloqueados} bloqueados<br /></>}
                      {f.avisos_en_cola > 0 && <>{f.avisos_en_cola} avisos</>}
                      {f.novedades_pendientes + f.vehiculos_bloqueados + f.avisos_en_cola === 0 && "—"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {abierto ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="c-btn chico" disabled={busy} onClick={() => guardar(f)}>
                            {busy ? "…" : "Guardar"}
                          </button>
                          <button className="c-btn chico fantasma" disabled={busy} onClick={() => setEditando(null)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button className="c-btn chico fantasma" onClick={() => abrirEdicion(f)}>Plan</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="c-bloque">
        <div className="c-bloque-head">
          <div>
            <div className="c-bloque-titulo">Consumo</div>
            <div className="c-bloque-sub">Para saber cuándo hay que subir de plan en Supabase.</div>
          </div>
        </div>
        <div className="c-bloque-cuerpo c-menor" style={{ lineHeight: 1.8, fontSize: 13 }}>
          <strong style={{ color: "var(--c-texto)" }}>{total.evidencias}</strong> fotos de evidencia en total.
          Con la compresión aplicada (~300 KB cada una), eso son aproximadamente{" "}
          <strong style={{ color: "var(--c-texto)" }}>{(total.evidencias * 0.3).toFixed(1)} MB</strong> del bucket privado.
          El plan gratuito de Supabase ofrece 1 GB; el Pro, 100 GB.
        </div>
      </div>

      <div className={"c-toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
