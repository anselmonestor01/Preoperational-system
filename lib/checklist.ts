// Reglas del checklist: opciones por tipo de ítem, severidad de cada respuesta y
// previsualización del resultado. El veredicto definitivo lo recalcula la BD.
import type { ItemType, Severity } from "./types";

// Opciones por tipo de ítem (espejo EXACTO de app.severity_of en la BD).
// El resultado final SIEMPRE lo recalcula el servidor; esto es sólo UI.
export const ITEM_OPTIONS: Record<
  ItemType,
  { value: string; label: string; sev: Severity }[]
> = {
  nivel: [
    { value: "lleno", label: "Lleno", sev: "ok" },
    { value: "medio", label: "Medio", sev: "warn" },
    { value: "bajo", label: "Bajo", sev: "warn" },
    { value: "vacio", label: "Vacío", sev: "bad" },
  ],
  estado: [
    { value: "bueno", label: "Bueno", sev: "ok" },
    { value: "regular", label: "Regular", sev: "warn" },
    { value: "malo", label: "Malo", sev: "bad" },
  ],
  equipo: [
    { value: "tiene", label: "Tiene", sev: "ok" },
    { value: "incompleto", label: "Incompleto", sev: "warn" },
    { value: "no_tiene", label: "No tiene", sev: "bad" },
  ],
};

export function optionsFor(type: ItemType) {
  return ITEM_OPTIONS[type] ?? ITEM_OPTIONS.estado;
}

export function severityOf(type: ItemType, value: string): Severity | null {
  return optionsFor(type).find((o) => o.value === value)?.sev ?? null;
}

export function labelOf(type: ItemType, value: string): string {
  return optionsFor(type).find((o) => o.value === value)?.label ?? "";
}

// Resultado previsto en el cliente (el servidor lo confirma/recalcula).
export function previewResult(counts: { warn: number; bad: number }) {
  if (counts.bad === 0 && counts.warn === 0) return "bueno";
  if (counts.bad > 0) return "malo";
  return "regular";
}
