"use client";

// Límite de error del panel. Sin él, un fallo de consulta dejaba el módulo
// pintado en blanco como si no hubiera datos: la avería era invisible.
import { useEffect } from "react";

export default function ErrorPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[panel]", error); }, [error]);

  return (
    <div className="panel estado-grave">
      <div className="estado-icono" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01M10.3 3.9 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      </div>
      <h2 className="estado-titulo">No se pudo cargar este módulo</h2>
      <p className="estado-texto">
        Los datos no llegaron. Esto <b>no</b> significa que estén vacíos: significa que la
        consulta falló. No se ha modificado nada.
      </p>
      <p className="estado-detalle">{error.message}</p>
      <div className="estado-acciones">
        <button className="btn btn-primary btn-sm" onClick={reset}>Reintentar</button>
        <a className="btn btn-ghost btn-sm" href="/admin">Ir al panel</a>
      </div>
    </div>
  );
}
