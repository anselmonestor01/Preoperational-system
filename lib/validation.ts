// Reglas de validación de los datos que escribe el usuario.
//
// IMPORTANTE — dónde está la defensa real
// Esto es la capa de COMODIDAD: avisa al usuario antes de enviar y evita que
// escriba letras donde van números. No es la seguridad del sistema.
//
// La defensa real son las restricciones CHECK de PostgreSQL (migración
// `input_constraints`), porque quien quiera atacar el sistema no va a usar el
// formulario: va a llamar la API directamente. Los límites de aquí son un
// espejo EXACTO de los de la base de datos; si cambian allá, cambian aquí.
//
// Sobre inyección de código: el sistema usa consultas parametrizadas (nunca
// arma SQL concatenando texto) y React escapa todo lo que muestra, así que ni
// SQL ni scripts llegan a ejecutarse. Lo que estos límites cubren es el otro
// frente: que alguien envíe millones de caracteres para degradar el servicio.

/** Longitudes máximas, iguales a las restricciones de la base de datos. */
export const LIMITES = {
  placa: { min: 3, max: 15 },
  referencia: { min: 0, max: 80 },
  nombreConductor: { min: 3, max: 80 },
  licencia: { min: 3, max: 30 },
  whatsapp: { min: 7, max: 20 },
  nombreRonda: { min: 3, max: 80 },
  responsable: { min: 3, max: 80 },
  notas: { min: 0, max: 500 },
  observaciones: { min: 0, max: 1000 },
  descripcion: { min: 0, max: 1000 },
  nombreItem: { min: 2, max: 100 },
  nombreCategoria: { min: 2, max: 60 },
  pin: { min: 4, max: 4 },
} as const;

/** Un camión no supera el millón de km en su vida útil; el tope deja margen. */
export const KM_MAX = 9_999_999;

/**
 * Dígitos que debe tener un número de WhatsApp, indicativo de país incluido.
 * Siete es el número local más corto que existe; quince es el máximo que define
 * la norma E.164. Coincide con lo que valida el servidor.
 */
export const WHATSAPP_DIGITOS = { min: 7, max: 15 } as const;

/** Sólo dígitos. Para kilometraje y PIN. */
export function soloDigitos(v: string): string {
  return v.replace(/\D+/g, "");
}

/** Dígitos y los símbolos válidos de un teléfono. */
export function soloTelefono(v: string): string {
  return v.replace(/[^\d+()\s-]/g, "");
}

/** Placa: letras, números y guion; en mayúsculas. */
export function soloPlaca(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

/**
 * Normaliza un texto libre: recorta espacios sobrantes y aplica el tope.
 * El recorte importa porque " " no es un nombre, aunque ocupe un carácter.
 */
export function limpiarTexto(v: string, max: number): string {
  return v.replace(/\s+/g, " ").trimStart().slice(0, max);
}

/** Kilometraje válido: número entero, no negativo y dentro del tope. */
export function kmValido(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined || v === "") return false;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= KM_MAX;
}

/**
 * El kilometraje de regreso nunca puede ser menor que el de salida.
 * Un error de digitación aquí falsea el recorrido de toda la operación.
 */
export function kmRegresoValido(inicial: number | null, final: number | null): boolean {
  if (inicial === null || final === null) return false;
  if (!kmValido(inicial) || !kmValido(final)) return false;
  return final >= inicial;
}

/** ¿El texto cumple el mínimo y el máximo, ignorando espacios sobrantes? */
export function textoValido(v: string, limite: { min: number; max: number }): boolean {
  const t = (v ?? "").trim();
  return t.length >= limite.min && t.length <= limite.max;
}

/**
 * Teléfono opcional: vacío es válido; si hay algo, debe tener formato.
 *
 * Se cuentan los DÍGITOS, no los caracteres: "+57 301 198 7446" y
 * "573011987446" son el mismo número y ambos deben aceptarse. Los límites son
 * los mismos que aplica `set_driver_whatsapp` en la base de datos, para que el
 * navegador nunca deje pasar algo que el servidor va a rechazar.
 */
export function telefonoValido(v: string): boolean {
  const t = (v ?? "").trim();
  if (t === "") return true;
  if (!/^[0-9+()\s-]+$/.test(t)) return false;
  const digitos = t.replace(/\D+/g, "").length;
  return digitos >= WHATSAPP_DIGITOS.min && digitos <= WHATSAPP_DIGITOS.max;
}

/** Licencia opcional: vacía es válida; si hay algo, debe cumplir longitud. */
export function licenciaValida(v: string): boolean {
  const t = (v ?? "").trim();
  if (t === "") return true;
  return t.length >= LIMITES.licencia.min && t.length <= LIMITES.licencia.max;
}

/** PIN: exactamente 4 dígitos. */
export function pinValido(v: string): boolean {
  return /^\d{4}$/.test(v ?? "");
}
