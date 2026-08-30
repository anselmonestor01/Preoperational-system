// Traduce errores técnicos (Postgres/PostgREST/Supabase) a mensajes para el
// usuario. El detalle técnico se registra en consola para diagnóstico interno.
export function friendlyError(error: unknown, fallback = "Ocurrió un error. Intenta nuevamente."): string {
  const raw =
    (error as any)?.message ??
    (typeof error === "string" ? error : "") ??
    "";
  const msg = String(raw);

  // Errores de negocio que YA vienen en español desde los RPC (RAISE EXCEPTION):
  // se muestran tal cual porque son mensajes pensados para el usuario.
  const businessSpanish = [
    "No autorizado", "No hay una ronda", "Vehículo no encontrado", "Conductor no encontrado",
    "El vehículo", "Este vehículo", "El PIN", "El motivo", "Motivo obligatorio",
    "La operación", "El kilometraje", "Novedad no encontrada", "Inspección no encontrada",
  ];
  if (businessSpanish.some((p) => msg.startsWith(p) || msg.includes(p))) return msg;

  // Errores técnicos conocidos → mensaje genérico.
  if (msg.includes("multiple") && msg.includes("row")) return fallback;
  if (msg.toLowerCase().includes("permission denied")) return "No tienes permiso para realizar esta acción.";
  if (msg.toLowerCase().includes("duplicate key") || msg.includes("23505")) return "Ese registro ya existe.";
  if (msg.toLowerCase().includes("foreign key") || msg.includes("23503")) return "No se puede completar: hay información relacionada.";
  if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch")) return "Problema de conexión. Verifica tu red e intenta de nuevo.";

  // Log interno (no visible al usuario).
  if (typeof console !== "undefined") console.error("[MM error]", error);
  return fallback;
}
