"use client";

// Selector de empresa de la barra lateral.
//
// Sólo aparece si el usuario pertenece a más de una. Con una sola empresa —el
// caso de casi todos— no se ve nada, para no añadir ruido a una decisión que no
// existe.
//
// El cambio lo hace el RPC `switch_organization`, que valida la pertenencia en
// la base de datos. Marcar otra empresa desde el navegador no da acceso a nada:
// `app.current_org()` vuelve a comprobarlo en cada consulta.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

type Empresa = { id: string; name: string; role: string; activa: boolean };

export default function OrgSwitcher({ actual }: { actual: string | null }) {
  const supabase = createClient();
  const router = useRouter();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.rpc("my_organizations").then(({ data }) => setEmpresas((data as Empresa[]) ?? []));
  }, [supabase]);

  // Cerrar al tocar fuera.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  if (empresas.length <= 1) return null;

  async function cambiar(id: string) {
    setBusy(true); setError("");
    const { error } = await supabase.rpc("switch_organization", { p_org_id: id });
    setBusy(false);
    if (error) { setError(friendlyError(error, "No fue posible cambiar de empresa.")); return; }
    setAbierto(false);
    // Recarga completa: todo el panel depende de la empresa activa.
    window.location.href = "/admin";
  }

  return (
    <div className="org-switcher" ref={caja}>
      <button className="org-switcher-btn" onClick={() => setAbierto((a) => !a)} disabled={busy}>
        <span className="org-switcher-name">{actual ?? "Seleccionar empresa"}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {abierto && (
        <div className="org-switcher-menu">
          <div className="org-switcher-titulo">Cambiar de empresa</div>
          {empresas.map((e) => (
            <button key={e.id} className={"org-switcher-item" + (e.activa ? " activa" : "")}
                    disabled={busy || e.activa} onClick={() => cambiar(e.id)}>
              <span>{e.name}</span>
              {e.activa
                ? <span className="org-switcher-check">✓</span>
                : <span className="org-switcher-rol">{e.role}</span>}
            </button>
          ))}
          {error && <div className="org-switcher-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
