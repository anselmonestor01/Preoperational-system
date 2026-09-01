// Formato de fecha/hora/número en zona Colombia (America/Bogota).
// Los timestamps son del servidor; aquí sólo se presentan al usuario.

const TZ = "America/Bogota";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CO", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-CO", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("es-CO");
}

export function fmtKm(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n.toLocaleString("es-CO")} km`;
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
