// Canjear la clave de consola por una sesión de 8 horas.
//
// Esto vive en el servidor y no en el navegador por una razón concreta: el
// identificador de sesión que devuelve la base tiene que acabar en una cookie
// httpOnly, y una cookie httpOnly sólo la puede poner el servidor. Si el
// navegador llamara al RPC directamente, el identificador quedaría en memoria
// de JavaScript y cualquier script inyectado podría leerlo.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_CONSOLA, OPCIONES_COOKIE } from "@/lib/consola";

export const dynamic = "force-dynamic";

interface Resultado {
  ok?: boolean;
  motivo?: string;
  mensaje?: string;
  token?: string;
  expira?: string;
}

export async function POST(request: Request) {
  let clave = "";
  try {
    const body = (await request.json()) as { clave?: unknown };
    clave = typeof body.clave === "string" ? body.clave : "";
  } catch {
    return NextResponse.json({ ok: false, mensaje: "Petición inválida." }, { status: 400 });
  }
  if (!clave) {
    return NextResponse.json({ ok: false, mensaje: "Escribe la clave de consola." }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("open_console_session", { p_clave: clave });

  // Un error aquí es "no eres superadministrador" o un fallo real de la base.
  // La clave incorrecta NO llega por esta vía: llega como `ok: false`, para que
  // el intento fallido quede contado en lugar de revertirse con la excepción.
  if (error) {
    return NextResponse.json(
      { ok: false, mensaje: "No tienes acceso a la consola de plataforma." },
      { status: 403 },
    );
  }

  const r = (data ?? {}) as Resultado;
  if (!r.ok || !r.token) {
    return NextResponse.json(
      { ok: false, mensaje: r.mensaje ?? "No fue posible abrir la consola.", motivo: r.motivo },
      { status: 401 },
    );
  }

  const respuesta = NextResponse.json({ ok: true, expira: r.expira });
  respuesta.cookies.set(COOKIE_CONSOLA, r.token, OPCIONES_COOKIE);
  return respuesta;
}
