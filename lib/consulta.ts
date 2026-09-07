// Que una consulta falle no puede parecerse a que no haya datos.
//
// EL PROBLEMA QUE RESUELVE
// Las páginas del panel leían así:
//
//     const { data: rows } = await supabase.from("vehicles").select("*");
//
// Sin mirar `error`. Si la consulta falla —RLS mal aplicada, red caída, una
// columna renombrada— `rows` llega `null`, la página pinta su estado vacío y
// el administrador ve «no hay vehículos». Es la peor forma de fallar: la
// pantalla parece terminada y correcta, y está rota. Un módulo vacío por avería
// y un módulo vacío por ser nuevo tienen que verse distintos.
//
// `oExplota` convierte el fallo silencioso en un error real, que el límite de
// error del segmento (`app/admin/error.tsx`) recoge y explica.

type Respuesta<T> = { data: T | null; error: { message?: string } | null };

export function oExplota<T>(res: Respuesta<T>, contexto: string): T | null {
  if (res.error) {
    throw new Error(`No se pudo cargar ${contexto}: ${res.error.message ?? "error desconocido"}`);
  }
  return res.data;
}
