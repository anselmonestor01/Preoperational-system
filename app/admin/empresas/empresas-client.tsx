"use client";

// Crear una empresa y entrar en ella.
//
// El alta la hace `create_organization`, que copia el catálogo del checklist
// completo —con sus 14 marcas de crítico de seguridad— y publica la versión 1
// en la misma transacción. Esa copia no es comodidad: la batería de pruebas
// descubrió en su día que un catálogo sin marcas de criticidad autoriza a un
// camión con los frenos malos. Una empresa nueva no puede nacer así.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";
import { limpiarTexto, textoValido } from "@/lib/validation";

export interface EmpresaRow {
  id: string; name: string; slug: string; timezone: string | null;
  max_non_critical_bad: number; active: boolean; created_at: string;
  plan: string; billing_status: string;
}

const LIMITE_NOMBRE = { min: 3, max: 80 };

const ZONAS = [
  "America/Bogota", "America/Lima", "America/Mexico_City",
  "America/Santiago", "America/Guayaquil", "America/Panama",
];

export default function EmpresasClient({
  empresas, empresaActiva,
}: { empresas: EmpresaRow[]; empresaActiva: string }) {
  const supabase = createClient();
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [zona, setZona] = useState("America/Bogota");
  const [maxFallas, setMaxFallas] = useState("3");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 4000); };
  const nombreValido = textoValido(nombre, LIMITE_NOMBRE);

  async function crear() {
    setBusy(true); setError("");
    const { data, error } = await supabase.rpc("create_organization", {
      p_nombre: nombre.trim(),
      p_zona_horaria: zona,
      p_max_fallas: Number(maxFallas),
    });
    setBusy(false);
    if (error) { setError(friendlyError(error, "No fue posible crear la empresa.")); return; }

    const r = data as { nombre?: string; items?: number; items_criticos?: number };
    show(`"${r?.nombre}" creada con ${r?.items} ítems (${r?.items_criticos} críticos de seguridad).`);
    setNombre("");
    router.refresh();
  }

  async function entrar(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc("switch_organization", { p_org_id: id });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible entrar a esa empresa."));
    window.location.href = "/admin";
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Nueva empresa</div>
            <div className="panel-sub">
              Nace con el checklist completo copiado y su versión 1 publicada.
            </div>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="nombre">Nombre de la empresa</label>
          <input id="nombre" className="manage-input" style={{ width: "100%" }}
            value={nombre} maxLength={LIMITE_NOMBRE.max}
            placeholder="Ej. Transportes del Valle S.A.S."
            onChange={(e) => setNombre(limpiarTexto(e.target.value, LIMITE_NOMBRE.max))} />
          {nombre.length > 0 && !nombreValido && (
            <div className="cell-sub" style={{ color: "var(--orange)", marginTop: 4 }}>
              Entre {LIMITE_NOMBRE.min} y {LIMITE_NOMBRE.max} caracteres.
            </div>
          )}
        </div>

        <div className="grid-2">
          <div className="form-group">
            <label htmlFor="zona">Zona horaria</label>
            <select id="zona" className="manage-input" style={{ width: "100%" }}
              value={zona} onChange={(e) => setZona(e.target.value)}>
              {ZONAS.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="max">Fallas no críticas que bloquean la salida</label>
            <input id="max" className="manage-input" style={{ width: "100%" }}
              inputMode="numeric" maxLength={2} value={maxFallas}
              onChange={(e) => setMaxFallas(e.target.value.replace(/\D+/g, "").slice(0, 2))} />
          </div>
        </div>

        {error && <div className="err-box" style={{ marginBottom: 12 }}>{error}</div>}

        <button className="btn btn-primary" disabled={!nombreValido || busy} onClick={crear}>
          {busy ? "Creando…" : "Crear empresa"}
        </button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Empresas</div>
            <div className="panel-sub">{empresas.length} en la plataforma.</div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr><th>Empresa</th><th>Plan</th><th>Zona</th><th>Creada</th><th></th></tr>
            </thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.name}</strong>
                    {e.id === empresaActiva && <span className="badge info" style={{ marginLeft: 8 }}>Estás aquí</span>}
                    <div className="cell-sub">{e.slug}</div>
                  </td>
                  <td><span className="badge neutral">{e.plan}</span></td>
                  <td className="cell-sub">{e.timezone}</td>
                  <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.created_at)}</td>
                  <td>
                    {e.id !== empresaActiva && (
                      <button className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={() => entrar(e.id)}>Entrar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
