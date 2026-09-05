// Por qué una inspección terminó como terminó.
//
// EL PROBLEMA QUE RESUELVE
// El historial mostraba etiquetas sueltas —"cerrada", "malo", "abierta"— que no
// dicen nada por sí solas. Una inspección "cerrada" podía serlo porque el
// conductor registró el regreso sin novedades, porque volvió con hallazgos que
// siguen abiertos, o porque un administrador la cerró a mano. Tres historias
// distintas bajo la misma palabra.
//
// Aquí se traduce el estado en bruto a una frase que un jefe de flota entiende
// sin preguntar. Vive en un solo sitio a propósito: el tablero, el historial y
// los reportes tienen que contar exactamente lo mismo.

export type TonoMotivo = "ok" | "warn" | "bad" | "neutral" | "info";

export type Motivo = {
  tono: TonoMotivo;
  /** Qué pasó, en dos palabras. Va en la insignia. */
  titulo: string;
  /** Por qué. Va debajo, en letra pequeña. */
  detalle: string;
  /** Las dos cosas juntas, para una celda de tabla o una exportación. */
  texto: string;
};

/** Lo mínimo que hace falta saber de una inspección para explicarla. */
export type FilaMotivo = {
  status: string | null;
  authorized: boolean | null;
  result: string | null;
  operation_status: string | null;
  released?: boolean | null;
  auth_reasons?: unknown;
  warn_count?: number | null;
  bad_count?: number | null;
  void_reason?: string | null;
  /** Novedades que abrió esta inspección y siguen sin resolver. */
  novedades_abiertas?: number;
  /** Novedades que abrió esta inspección, resueltas o no. */
  novedades_total?: number;
};

/** `auth_reasons` llega como jsonb: puede ser array, texto o nada. */
function razones(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((r): r is string => typeof r === "string" && r.trim() !== "");
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

/**
 * La razón principal viene redactada desde la base
 * («Falla crítica de seguridad: Frenos»), así que se aprovecha tal cual en vez
 * de reconstruirla aquí y arriesgarse a que las dos versiones se separen.
 */
function primeraRazon(v: unknown): string {
  const r = razones(v);
  if (!r.length) return "";
  return r.length === 1 ? r[0] : `${r[0]} (+${r.length - 1} más)`;
}

function plural(n: number, singular: string, prural: string) {
  return `${n} ${n === 1 ? singular : prural}`;
}

export function motivoDe(i: FilaMotivo): Motivo {
  const armar = (tono: TonoMotivo, titulo: string, detalle: string): Motivo =>
    ({ tono, titulo, detalle, texto: detalle ? `${titulo} — ${detalle}` : titulo });

  // 1. Anulada: deja de contar para la operación, pero se conserva.
  if (i.status === "voided") {
    return armar("neutral", "Anulada",
      i.void_reason?.trim() || "retirada del historial operativo por administración");
  }

  // 2. No autorizada: el vehículo no salió. El motivo ya viene redactado.
  if (i.authorized === false) {
    return armar("bad", "No autorizada",
      primeraRazon(i.auth_reasons) || "no superó el checklist preoperacional");
  }

  // 3. Autorizada y todavía fuera.
  if (i.operation_status === "open") {
    return armar("info", "En ruta", "salida autorizada, regreso sin registrar");
  }

  // 4. Autorizada y de vuelta. Aquí es donde «cerrada» significaba tres cosas.
  if (i.operation_status === "closed" || i.status === "closed") {
    const abiertas = i.novedades_abiertas ?? 0;
    const total = i.novedades_total ?? 0;

    if (abiertas > 0) {
      return armar("warn", "Cerrada con novedades",
        `${plural(abiertas, "novedad", "novedades")} sin resolver — la unidad sigue retenida`);
    }
    if (total > 0) {
      return armar("ok", "Cerrada",
        `${plural(total, "novedad", "novedades")} reportadas y ya resueltas`);
    }
    if (i.released === false) {
      return armar("warn", "Cerrada", "la unidad no quedó liberada para la ronda");
    }
    return armar("ok", "Cerrada", "regreso registrado sin novedades");
  }

  // 5. Autorizada sin operación abierta: el vehículo quedó habilitado para salir.
  if (i.authorized === true) {
    const conHallazgos = (i.bad_count ?? 0) + (i.warn_count ?? 0) > 0;
    return armar(conHallazgos ? "warn" : "ok", "Autorizada",
      conHallazgos
        ? `con ${plural((i.bad_count ?? 0) + (i.warn_count ?? 0), "hallazgo menor", "hallazgos menores")}`
        : "sin novedades");
  }

  return armar("neutral", "Sin estado", "");
}

/**
 * Etiqueta corta del resultado del checklist, separada del motivo porque son
 * dos preguntas distintas: «¿cómo está el vehículo?» y «¿qué pasó con la salida?».
 */
export function etiquetaResultado(result: string | null): { tono: TonoMotivo; texto: string } {
  if (result === "bueno") return { tono: "ok", texto: "Bueno" };
  if (result === "regular") return { tono: "warn", texto: "Regular" };
  if (result === "malo") return { tono: "bad", texto: "Malo" };
  return { tono: "neutral", texto: "—" };
}
