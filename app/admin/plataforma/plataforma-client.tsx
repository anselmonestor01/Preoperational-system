"use client";

// Panorama de todas las empresas de la plataforma.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { useDialog } from "@/components/ui/dialogs";

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

export default function PlataformaClient({
  filas, errorLectura,
}: { filas: FilaPlataforma[]; errorLectura: string | null }) {
  const supabase = createClient();
  const router = useRouter();
  const dialog = useDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const total = useMemo(() => ({
    empresas: filas.length,
    vehiculos: filas.reduce((n, f) => n + f.vehiculos, 0),
    conductores: filas.reduce((n, f) => n + f.conductores, 0),
    inspecciones30: filas.reduce((n, f) => n + f.inspecciones_30d, 0),
    evidencias: filas.reduce((n, f) => n + f.evidencias, 0),
  }), [filas]);

  // Empresas que merecen una llamada: sin actividad reciente, o con la cola
  // de avisos atascada. Es la parte que evita enterarse cuando ya cancelaron.
  const atencion = useMemo(() => filas.filter((f) => {
    const d = diasDesde(f.ultima_actividad);
    return d === null || d > 7 || f.avisos_en_cola > 10 || f.billing_status !== "al_dia";
  }), [filas]);

  async function cambiarPlan(f: FilaPlataforma) {
    const plan = await dialog.prompt({
      title: `Plan de ${f.nombre}`,
      message: `Planes: ${PLANES.join(" · ")}`,
      label: "Plan",
      defaultValue: f.plan,
      required: true,
      validate: (v) => (PLANES.includes(v.trim()) ? null : `Debe ser uno de: ${PLANES.join(", ")}`),
      confirmLabel: "Guardar",
    });
    if (plan === null) return;

    const estado = await dialog.prompt({
      title: `Estado de pago de ${f.nombre}`,
      message: "Estados: al_dia · pendiente · suspendido",
      label: "Estado",
      defaultValue: f.billing_status,
      required: true,
      validate: (v) => (Object.keys(ESTADOS).includes(v.trim()) ? null : "Debe ser al_dia, pendiente o suspendido"),
      confirmLabel: "Guardar",
    });
    if (estado === null) return;

    setBusy(f.organization_id);
    const { error } = await supabase.rpc("set_organization_billing", {
      p_org_id: f.organization_id, p_plan: plan.trim(),
      p_status: estado.trim(), p_note: f.billing_note,
    });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible actualizar el plan."));
    show("Plan actualizado");
    router.refresh();
  }

  return (
    <>
      {errorLectura && (
        <div className="panel">
          <div className="dialog-warning" style={{ marginBottom: 0 }}>
            <strong>No se pudo cargar el panorama.</strong> {errorLectura}
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-label">Empresas</div><div className="kpi-value">{total.empresas}</div></div>
        <div className="kpi"><div className="kpi-label">Vehículos</div><div className="kpi-value">{total.vehiculos}</div></div>
        <div className="kpi"><div className="kpi-label">Conductores</div><div className="kpi-value">{total.conductores}</div></div>
        <div className="kpi"><div className="kpi-label">Inspecciones 30 días</div><div className="kpi-value">{total.inspecciones30}</div></div>
      </div>

      {atencion.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Requieren atención</div>
              <div className="panel-sub">
                Sin actividad en más de 7 días, con la cola de avisos atascada, o con el pago al día pendiente.
              </div>
            </div>
          </div>
          <div className="manage-list">
            {atencion.map((f) => {
              const d = diasDesde(f.ultima_actividad);
              return (
                <div key={f.organization_id} className="manage-row manage-row-sm">
                  <div className="manage-row-main">
                    {f.nombre}
                    {f.billing_status !== "al_dia" && (
                      <span className={"badge " + (ESTADOS[f.billing_status]?.clase ?? "neutral")}>
                        {ESTADOS[f.billing_status]?.texto ?? f.billing_status}
                      </span>
                    )}
                  </div>
                  <span className="cell-sub">
                    {d === null ? "nunca ha registrado una inspección"
                      : d > 7 ? `sin actividad hace ${d} días`
                      : f.avisos_en_cola > 10 ? `${f.avisos_en_cola} avisos atascados`
                      : "pago pendiente"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Todas las empresas</div>
            <div className="panel-sub">
              Sólo conteos: esta pantalla no muestra placas, conductores ni fotos de ninguna empresa.
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Empresa</th><th>Plan</th><th>Flota</th><th>Usuarios</th>
                <th>7 días</th><th>30 días</th><th>Última actividad</th>
                <th>Pendientes</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const d = diasDesde(f.ultima_actividad);
                const e = ESTADOS[f.billing_status] ?? { texto: f.billing_status, clase: "neutral" };
                return (
                  <tr key={f.organization_id}>
                    <td>
                      <strong>{f.nombre}</strong>
                      <div className="cell-sub">
                        {f.ronda_abierta ? "ronda abierta" : "sin ronda abierta"} · desde {fmtDateTime(f.creada)}
                      </div>
                    </td>
                    <td>
                      <span className="badge neutral">{f.plan}</span>
                      <div className="cell-sub"><span className={"badge " + e.clase}>{e.texto}</span></div>
                    </td>
                    <td className="cell-sub">{f.vehiculos} veh · {f.conductores} cond</td>
                    <td className="cell-sub">{f.usuarios}</td>
                    <td><strong>{f.inspecciones_7d}</strong></td>
                    <td className="cell-sub">{f.inspecciones_30d}</td>
                    <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>
                      {d === null ? "—" : d === 0 ? "hoy" : `hace ${d} d`}
                    </td>
                    <td className="cell-sub">
                      {f.novedades_pendientes > 0 && <>{f.novedades_pendientes} novedades<br /></>}
                      {f.vehiculos_bloqueados > 0 && <>{f.vehiculos_bloqueados} bloqueados<br /></>}
                      {f.avisos_en_cola > 0 && <>{f.avisos_en_cola} avisos</>}
                      {f.novedades_pendientes + f.vehiculos_bloqueados + f.avisos_en_cola === 0 && "—"}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" disabled={busy === f.organization_id}
                        onClick={() => cambiarPlan(f)}>Plan</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Consumo</div>
            <div className="panel-sub">Para saber cuándo hay que subir de plan en Supabase.</div>
          </div>
        </div>
        <div className="cell-sub" style={{ lineHeight: 1.7 }}>
          <strong>{total.evidencias}</strong> fotos de evidencia en total.
          Con la compresión aplicada (~300 KB cada una), eso son aproximadamente{" "}
          <strong>{(total.evidencias * 0.3).toFixed(1)} MB</strong> del bucket privado.
          El plan gratuito de Supabase ofrece 1 GB; el Pro, 100 GB.
        </div>
      </div>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
