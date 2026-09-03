// Establecer o cambiar la clave de consola, y dejar la consola abierta.
//
// La primera vez no hay clave anterior: la pantalla de acceso lo detecta y pide
// sólo la nueva. A partir de ahí la actual es obligatoria, para que una sesión
// olvidada abierta en un equipo ajeno no permita cambiarla sin conocerla.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_CONSOLA, OPCIONES_COOKIE } from "@/lib/consola";
import { friendlyError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let actual: string | null = null;
  let nueva = "";
  try {
    const body = (await request.json()) as { actual?: unknown; nueva?: unknown };
    actual = typeof body.actual === "string" && body.actual ? body.actual : null;
    nueva = typeof body.nueva === "string" ? body.nueva : "";
  } catch {
    return NextResponse.json({ ok: false, mensaje: "Petición inválida." }, { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("set_console_password", {
    p_actual: actual,
    p_nueva: nueva,
  });
  if (error) {
    return NextResponse.json(
      { ok: false, mensaje: friendlyError(error, "No fue posible guardar la clave.") },
      { status: 400 },
    );
  }

  // Cambiar la clave cierra todas las consolas abiertas, incluida la de quien
  // la está cambiando. Se le vuelve a abrir aquí para no expulsarlo de la
  // pantalla en la que está.
  const { data, error: errAbrir } = await supabase.rpc("open_console_session", { p_clave: nueva });
  const r = (data ?? {}) as { ok?: boolean; token?: string; expira?: string };
  if (errAbrir || !r.ok || !r.token) {
    return NextResponse.json({ ok: true, reabierta: false });
  }

  const respuesta = NextResponse.json({ ok: true, reabierta: true, expira: r.expira });
  respuesta.cookies.set(COOKIE_CONSOLA, r.token, OPCIONES_COOKIE);
  return respuesta;
}
