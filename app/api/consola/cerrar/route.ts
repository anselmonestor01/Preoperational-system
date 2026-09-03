// Salir de la consola SIN cerrar la sesión de correo.
//
// Son dos cerraduras distintas y se cierran por separado a propósito: salir de
// la consola no debe echar al usuario del panel de administración en el que
// quizá siga trabajando.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_CONSOLA } from "@/lib/consola";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = cookies().get(COOKIE_CONSOLA)?.value;
  if (token) {
    const supabase = createClient();
    const { error } = await supabase.rpc("close_console_session", { p_token: token });
    if (error) console.error("[consola] no se pudo revocar la sesión:", error.message);
  }
  const respuesta = NextResponse.redirect(new URL("/consola/acceso", request.url), { status: 303 });
  respuesta.cookies.set(COOKIE_CONSOLA, "", { path: "/", maxAge: 0 });
  return respuesta;
}
