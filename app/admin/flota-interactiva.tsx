"use client";

// Las partes del tablero que responden al clic.
//
// EL PROBLEMA QUE RESUELVE
// El tablero enumeraba placas bloqueadas y novedades pendientes como texto
// muerto: informaba de que algo pasaba y ahí terminaba su ayuda. La siguiente
// pregunta —«¿por qué esa unidad, desde cuándo, con qué evidencia?»— obligaba a
// abandonar el tablero e ir a buscarla a mano.
//
// Ahora cada placa y cada alerta abren la ficha completa de la unidad sin salir
// de la página.

import { useState } from "react";
import VehicleSheet from "@/components/admin/VehicleSheet";
import { antiguedad, CLASE_URGENCIA, type NivelUrgencia } from "@/lib/urgencia";

export type UnidadChip = {
  id: string; plate: string; nota?: string;
  tono?: "ok" | "warn" | "bad" | "";
};

export type Alerta = {
  vehicleId: string; plate: string;
  titulo: string; sub: string;
  nivel: NivelUrgencia; horas: number;
};

/** Fila de placas que abren la ficha de la unidad al pulsarlas. */
export function ChipsDeUnidades({ unidades, vacio }: { unidades: UnidadChip[]; vacio: string }) {
  const [abierta, setAbierta] = useState<UnidadChip | null>(null);
  if (!unidades.length) return <div className="empty-state" style={{ padding: "30px 10px" }}>{vacio}</div>;
  return (
    <>
      <div className="plate-chip-list">
        {unidades.map((u) => (
          <button key={u.id} className={"chip-placa-btn " + (u.tono ? "tono-" + u.tono : "")}
            onClick={() => setAbierta(u)} title={`Ver la ficha de ${u.plate}`}>
            {u.plate}
            {u.nota && <span className="chip-nota">{u.nota}</span>}
          </button>
        ))}
      </div>
      {abierta && <VehicleSheet vehicleId={abierta.id} plate={abierta.plate} onClose={() => setAbierta(null)} />}
    </>
  );
}

/**
 * Alertas ordenadas por lo que más tiempo lleva esperando.
 * Un listado sin orden de prioridad obliga a leerlo entero para saber qué
 * atender primero; éste pone arriba lo que peor pinta tiene.
 */
export function ListaDeAlertas({ alertas }: { alertas: Alerta[] }) {
  const [abierta, setAbierta] = useState<{ id: string; plate: string } | null>(null);
  if (!alertas.length) {
    return <div className="empty-state" style={{ padding: "30px 10px" }}>
      Nada requiere atención inmediata.
    </div>;
  }
  return (
    <>
      {alertas.map((a, i) => (
        <button key={i} className={"alerta-fila nivel-" + a.nivel}
          onClick={() => setAbierta({ id: a.vehicleId, plate: a.plate })}>
          <span className="alerta-placa">{a.plate}</span>
          <span className="alerta-cuerpo">
            <span className="alerta-titulo">{a.titulo}</span>
            <span className="alerta-sub">{a.sub}</span>
          </span>
          <span className={"badge " + CLASE_URGENCIA[a.nivel]} style={{ flexShrink: 0 }}>
            {antiguedad(a.horas)}
          </span>
        </button>
      ))}
      {abierta && <VehicleSheet vehicleId={abierta.id} plate={abierta.plate} onClose={() => setAbierta(null)} />}
    </>
  );
}
