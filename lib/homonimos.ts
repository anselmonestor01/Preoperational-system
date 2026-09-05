// Cuando dos personas se llaman igual.
//
// POR QUÉ HACE FALTA
// En una flota de doscientos conductores, dos «Juan Carlos Rodríguez» no es una
// rareza: es lo normal. Y el kiosco enseña sólo el nombre y la foto, así que el
// conductor toca el perfil equivocado, teclea su PIN y recibe «PIN incorrecto»
// sin la menor idea de por qué. El dato nunca se corrompe —el PIN lo impide—
// pero la persona se queda atascada delante de la tablet.
//
// La solución es enseñar lo mínimo que resuelve la ambigüedad, y sólo cuando la
// hay: los últimos dígitos de la licencia. Poner ese dato en TODAS las fichas
// sería exponer información de más para resolver un problema que casi nunca
// existe.

/** Nombres que aparecen más de una vez en la lista. */
export function nombresRepetidos(gente: { full_name: string }[]): Set<string> {
  const veces = new Map<string, number>();
  gente.forEach((p) => veces.set(p.full_name, (veces.get(p.full_name) ?? 0) + 1));
  const repes = new Set<string>();
  veces.forEach((n, nombre) => { if (n > 1) repes.add(nombre); });
  return repes;
}

/**
 * Cómo distinguir a esta persona de su homónimo. Devuelve cadena vacía cuando
 * su nombre es único, que es el caso de casi todos.
 */
export function distintivo(
  persona: { full_name: string; license?: string | null },
  repetidos: Set<string>,
): string {
  if (!repetidos.has(persona.full_name)) return "";
  const lic = (persona.license ?? "").replace(/\D/g, "");
  return lic ? `licencia …${lic.slice(-4)}` : "sin licencia registrada";
}
