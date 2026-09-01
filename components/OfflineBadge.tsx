"use client";

// Indicador de conexión y de inspecciones pendientes de enviar.
//
// Es deliberadamente visible: si una inspección está en cola, para la operación
// TODAVÍA NO EXISTE. El conductor tiene que saberlo, porque el vehículo no
// quedará autorizado hasta que la inspección llegue al servidor.

import { useEffect, useState } from "react";
import { leerCola } from "@/lib/offline";

export function useEstadoConexion() {
  const [enLinea, setEnLinea] = useState(true);

  useEffect(() => {
    const set = () => setEnLinea(navigator.onLine !== false);
    set();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);

  return enLinea;
}

/** Cantidad de inspecciones en cola; se refresca cuando cambia la conexión. */
export function usePendientes(refrescar: unknown) {
  const [pendientes, setPendientes] = useState(0);
  useEffect(() => {
    let vivo = true;
    leerCola().then((c) => { if (vivo) setPendientes(c.length); });
    return () => { vivo = false; };
  }, [refrescar]);
  return pendientes;
}

export default function OfflineBadge({ enLinea, pendientes }: { enLinea: boolean; pendientes: number }) {
  if (enLinea && pendientes === 0) {
    return <div className="home2-status"><span className="home2-dot" />En línea</div>;
  }

  if (!enLinea) {
    return (
      <div className="home2-status conn-off" title="Puedes seguir inspeccionando; se enviará al recuperar la señal">
        <span className="home2-dot" />
        Sin señal{pendientes > 0 ? ` · ${pendientes}` : ""}
      </div>
    );
  }

  return (
    <div className="home2-status conn-sync" title="Enviando las inspecciones guardadas sin señal">
      <span className="home2-dot" />
      Enviando {pendientes}
    </div>
  );
}
