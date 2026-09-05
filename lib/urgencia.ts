// Cuánto lleva algo esperando, y a partir de cuándo eso importa.
//
// Una novedad crítica abierta hace veinte minutos y una abierta hace tres días
// se veían exactamente igual en el panel. Esto pone la antigüedad delante y le
// da un color, para que lo urgente se distinga de lo reciente sin leer fechas.

export type NivelUrgencia = "reciente" | "atencion" | "urgente" | "critico";

/** Horas transcurridas desde una marca de tiempo. Negativo se trata como cero. */
export function horasDesde(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, ms / 3_600_000);
}

/**
 * Los umbrales son distintos según la gravedad, y eso es deliberado: una falla
 * crítica sin resolver a las 24 horas ya es un problema de gestión, mientras
 * que una plumilla reseca puede esperar la semana sin que nadie se alarme.
 */
export function nivelUrgencia(horas: number, grave: boolean): NivelUrgencia {
  if (grave) {
    if (horas >= 72) return "critico";
    if (horas >= 24) return "urgente";
    if (horas >= 8) return "atencion";
    return "reciente";
  }
  if (horas >= 168) return "critico";
  if (horas >= 72) return "urgente";
  if (horas >= 24) return "atencion";
  return "reciente";
}

/** Antigüedad en palabras: «hace 3 h», «hace 2 días». */
export function antiguedad(horas: number): string {
  if (horas < 1) return "hace menos de 1 h";
  if (horas < 24) return `hace ${Math.floor(horas)} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

/** Clase de insignia que corresponde a cada nivel. */
export const CLASE_URGENCIA: Record<NivelUrgencia, string> = {
  reciente: "neutral",
  atencion: "warn",
  urgente: "bad",
  critico: "bad",
};

/** Orden de mayor a menor urgencia, para listas priorizadas. */
export const PESO_URGENCIA: Record<NivelUrgencia, number> = {
  critico: 4, urgente: 3, atencion: 2, reciente: 1,
};
