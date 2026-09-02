// Formato de fecha/hora/número en zona Colombia (America/Bogota).
// Los timestamps son del servidor; aquí sólo se presentan al usuario.

const TZ = "America/Bogota";

/**
 * Normaliza los espacios "raros" que mete el formateador de fechas.
 *
 * POR QUÉ EXISTE ESTO
 * `toLocaleTimeString("es-CO")` produce "02:14 p. m." tanto en Node como en el
 * navegador... pero NO con el mismo byte: Node usa un espacio normal (U+0020)
 * entre "p." y "m.", y Chrome usa un espacio duro (U+00A0). Como el panel se
 * renderiza en el servidor y se hidrata en el cliente, esa diferencia invisible
 * hacía que React detectara un desajuste de hidratación en CADA fecha, tirara el
 * HTML del servidor y volviera a dibujar la página entera en el navegador.
 *
 * Se veía bien —por eso pasó desapercibido— pero costaba el renderizado del
 * servidor en todas las pantallas con fechas: inspecciones, avisos, rondas,
 * novedades y reportes.
 */
function normalizarEspacios(s: string): string {
  return s.replace(/[\u00A0\u202F\u2009]/g, " ");
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return normalizarEspacios(new Date(iso).toLocaleDateString("es-CO", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
  }));
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return normalizarEspacios(new Date(iso).toLocaleTimeString("es-CO", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  }));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return normalizarEspacios(n.toLocaleString("es-CO"));
}

export function fmtKm(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${normalizarEspacios(n.toLocaleString("es-CO"))} km`;
}

/**
 * Iniciales para el avatar. Se descartan los espacios sobrantes: sin eso, un
 * nombre capturado como "  Juan Pérez" producía un avatar en blanco, porque las
 * primeras posiciones del split eran cadenas vacías.
 */
export function initials(name: string): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
