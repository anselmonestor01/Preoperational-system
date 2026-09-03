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
  empresas, empresaActiva, errorLectura,
}: { empresas: EmpresaRow[]; empresaActiva: string; errorLectura: string | null }) {
  const supabase = createClient();
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [zona, setZona] = useState("America/Bogota");
  const [maxFallas, setMaxFallas] = useState("3");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 4500); };
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

  // Entrar a una empresa cambia la empresa activa y salta al panel de cliente.
  // Es un viaje de ida: para volver a la consola se escribe su dirección.
  async function entrar(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc("switch_organization", { p_org_id: id });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible entrar a esa empresa."));
    window.location.href = "/admin";
  }

  return (
    <>
      <h1 className="c-titulo">Empresas</h1>
      <p className="c-sub">
        Alta de clientes nuevos y entrada a la operación de cualquiera de ellos.
      </p>

      {errorLectura && (
        <div className="c-error">
          <strong>No se pudo listar las empresas.</strong> {errorLectura}
        </div>
      )}

      <div className="c-bloque">
        <div className="c-bloque-head">
          <div>
            <div className="c-bloque-titulo">Nueva empresa</div>
            <div className="c-bloque-sub">
              Nace con el checklist completo copiado y su versión 1 publicada.
            </div>
          </div>
        </div>
        <div className="c-bloque-cuerpo">
          <div className="c-campo">
            <label htmlFor="nombre">Nombre de la empresa</label>
            <input
              id="nombre" className="c-input" value={nombre} maxLength={LIMITE_NOMBRE.max}
              placeholder="Ej. Transportes del Valle S.A.S."
              onChange={(e) => setNombre(limpiarTexto(e.target.value, LIMITE_NOMBRE.max))}
            />
          </div>
          {nombre.length > 0 && !nombreValido && (
            <div className="c-pista c-mal">
              Entre {LIMITE_NOMBRE.min} y {LIMITE_NOMBRE.max} caracteres.
            </div>
          )}

          <div className="c-dos">
            <div className="c-campo">
              <label htmlFor="zona">Zona horaria</label>
              <select id="zona" className="c-input" value={zona} onChange={(e) => setZona(e.target.value)}>
                {ZONAS.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div className="c-campo">
              <label htmlFor="max">Fallas no críticas que bloquean la salida</label>
              <input
                id="max" className="c-input mono" inputMode="numeric" maxLength={2} value={maxFallas}
                onChange={(e) => setMaxFallas(e.target.value.replace(/\D+/g, "").slice(0, 2))}
              />
            </div>
          </div>

          {error && <div className="c-error">{error}</div>}

          <button className="c-btn" disabled={!nombreValido || busy} onClick={crear}>
            {busy ? "Creando…" : "Crear empresa"}
          </button>
        </div>
      </div>

      <div className="c-bloque">
        <div className="c-bloque-head">
          <div>
            <div className="c-bloque-titulo">En la plataforma</div>
            <div className="c-bloque-sub">{empresas.length} empresas.</div>
          </div>
        </div>
        <div className="c-scroll">
          <table className="c-tabla">
            <thead>
              <tr><th>Empresa</th><th>Plan</th><th>Zona</th><th>Creada</th><th /></tr>
            </thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.name}</strong>
                    {e.id === empresaActiva && (
                      <span className="c-pill aqui" style={{ marginLeft: 8 }}>Tu empresa activa</span>
                    )}
                    <div className="c-menor">{e.slug}</div>
                  </td>
                  <td><span className="c-pill">{e.plan}</span></td>
                  <td className="c-menor">{e.timezone}</td>
                  <td className="c-menor" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.created_at)}</td>
                  <td>
                    {e.id !== empresaActiva && (
                      <button className="c-btn chico fantasma" disabled={busy} onClick={() => entrar(e.id)}>
                        Entrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={"c-toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
