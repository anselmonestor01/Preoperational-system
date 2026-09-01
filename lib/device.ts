// Identidad del dispositivo del patio.
//
// PARA QUÉ SIRVE
// Resuelve dos problemas reales de operación:
//  1. Que dos teléfonos usen el mismo perfil de conductor a la vez, lo que
//     produciría a la misma persona "inspeccionando" dos vehículos a la vez.
//  2. Que cualquiera pueda cerrar el regreso de cualquier vehículo. Con esto,
//     el regreso se le ofrece SÓLO al aparato que registró la salida.
//
// QUÉ NO ES
// No es un control de seguridad. El identificador vive en el propio navegador
// y se puede borrar o copiar. Es un control de INTEGRIDAD OPERATIVA: evita
// confusiones y solapamientos honestos, no a un atacante decidido. La
// autorización real la siguen dando el rol del usuario y las políticas RLS.
//
// TAMPOCO GUARDA UBICACIÓN
// Se consideró registrar la ubicación del dispositivo y se descartó: es un dato
// personal del trabajador, exige su consentimiento explícito y no hace falta
// para resolver el problema. Basta con saber QUÉ aparato registró la salida.

const CLAVE = "preop-device-id";
const CLAVE_ETIQUETA = "preop-device-label";

/** Identificador estable de este dispositivo. Se crea la primera vez. */
export function deviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(CLAVE);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLAVE, id);
    }
    return id;
  } catch {
    // Modo privado con almacenamiento bloqueado: se usa un id efímero, que al
    // menos mantiene la coherencia dentro de la misma sesión.
    return "efimero";
  }
}

/**
 * Nombre legible del aparato, para que el administrador entienda un aviso de
 * "perfil en uso" sin tener que interpretar un identificador.
 */
export function deviceLabel(): string {
  if (typeof window === "undefined") return "";
  try {
    const guardada = localStorage.getItem(CLAVE_ETIQUETA);
    if (guardada) return guardada;
    const etiqueta = describirDispositivo(navigator.userAgent);
    localStorage.setItem(CLAVE_ETIQUETA, etiqueta);
    return etiqueta;
  } catch {
    return "Dispositivo";
  }
}

/** Traduce el user-agent a algo que una persona entienda. */
export function describirDispositivo(ua: string): string {
  const u = ua ?? "";
  if (/iPad/i.test(u)) return "iPad";
  if (/iPhone/i.test(u)) return "iPhone";
  if (/Android/i.test(u)) return /Mobile/i.test(u) ? "Teléfono Android" : "Tablet Android";
  if (/Windows/i.test(u)) return "Computador Windows";
  if (/Macintosh|Mac OS/i.test(u)) return "Mac";
  if (/Linux/i.test(u)) return "Computador Linux";
  return "Dispositivo";
}
