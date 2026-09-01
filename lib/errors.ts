// Traduce errores técnicos (Postgres/PostgREST/Supabase) a mensajes para el
// usuario. El detalle técnico se registra en consola para diagnóstico interno.

/**
 * Código SQLSTATE que Postgres asigna a `raise exception` en PL/pgSQL.
 *
 * Todas las reglas de negocio del sistema viven en funciones de base de datos y
 * se comunican con `raise exception '<mensaje en español>'`. Ese mensaje YA está
 * escrito para la persona que lo va a leer ("La contraseña no es correcta",
 * "El vehículo está bloqueado"), así que se muestra tal cual.
 *
 * Antes esto se resolvía con una lista de frases conocidas y cualquier mensaje
 * nuevo caía en el texto genérico: al equivocarse de contraseña al borrar una
 * ronda, el sistema decía "No fue posible eliminar la ronda" en vez de explicar
 * que la contraseña estaba mal. Mirar el código de error, y no el texto, evita
 * que vuelva a pasar con cada regla que se agregue.
 */
const REGLA_DE_NEGOCIO = "P0001";

/** Errores de Postgres que sí conviene traducir a un lenguaje comprensible. */
const TRADUCCIONES: Array<[RegExp, string]> = [
  [/permission denied|42501/i, "No tienes permiso para realizar esta acción."],
  [/duplicate key|23505/i, "Ese registro ya existe."],
  [/foreign key|23503/i, "No se puede completar: hay información relacionada que depende de este registro."],
  [/violates check constraint|23514/i, "Alguno de los datos no cumple el formato esperado."],
  [/not-null|23502/i, "Falta un dato obligatorio."],
  [/invalid input syntax|22P02/i, "Alguno de los datos tiene un formato inválido."],
  [/failed to fetch|network\s*error|networkerror|network request failed/i,
    "Problema de conexión. Verifica tu red e intenta de nuevo."],
  [/jwt|invalid token|token is expired/i,
    "Tu sesión expiró. Vuelve a iniciar sesión."],
];

export function friendlyError(error: unknown, fallback = "Ocurrió un error. Intenta nuevamente."): string {
  if (!error) return fallback;

  const e = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  const msg = String(e?.message ?? (typeof error === "string" ? error : "") ?? "").trim();
  const code = String(e?.code ?? "");

  // 1. Reglas de negocio: el mensaje viene escrito para el usuario final.
  if (code === REGLA_DE_NEGOCIO && msg) return msg;

  // 2. Errores técnicos conocidos.
  for (const [patron, texto] of TRADUCCIONES) {
    if (patron.test(msg) || patron.test(code)) return texto;
  }

  // 3. Cualquier otra cosa: mensaje genérico y detalle en consola para soporte.
  if (typeof console !== "undefined") {
    console.error("[Preoperational System] error sin traducir:", { code, message: msg, error });
  }
  return fallback;
}
