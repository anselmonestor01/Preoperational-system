// El QR entra directamente al kiosco, sin pasar por la pantalla de acceso.
//
// El conductor llega al patio, apunta la cámara al cartel y ya está dentro
// eligiendo su nombre. Antes aterrizaba en el formulario de acceso, que es
// exactamente el trámite que el cartel existía para evitar.
//
// CÓMO
// Cada empresa tiene un usuario de kiosco propio en Supabase Auth, con rol
// `operator`. El token del cartel ES la contraseña de ese usuario, así que este
// handler no inventa ningún mecanismo: hace el mismo `signInWithPassword` que
// haría una persona, sólo que del lado del servidor. De ahí salen las cookies
// de sesión normales y el resto del sistema —RLS, `app.current_org()`, cada
// RPC— no distingue este acceso de cualquier otro.
//
// EL TOKEN NO SE QUEDA EN LA BARRA DE DIRECCIONES
// Tras el intento se redirige a `/kiosco` limpio. Si no, el token quedaría en
// el historial del teléfono, en la lista de pestañas y en cualquier captura de
// pantalla que el conductor comparta.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Correo interno del usuario de kiosco de una empresa. Reservado: no recibe correo. */
function correoDeKiosco(slug: string): string {
  return `kiosco.${slug}@kiosco.invalid`;
}

// El `slug` lo genera la base al crear la empresa. Se valida igualmente antes
// de construir un correo con él: nunca se compone una identidad con texto que
// viene de la URL sin comprobar su forma.
const SLUG_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = (url.searchParams.get("e") ?? "").trim().toLowerCase();
  const token = url.searchParams.get("k") ?? "";

  const fallo = (motivo: string) =>
    NextResponse.redirect(new URL(`/login?motivo=${motivo}`, request.url), { status: 303 });

  if (!slug || !token || !SLUG_VALIDO.test(slug) || slug.length > 80) {
    return fallo("qr-invalido");
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: correoDeKiosco(slug),
    password: token,
  });

  if (error) {
    // No se distingue "empresa que no existe" de "token caducado": para quien
    // prueba códigos al azar, las dos respuestas deben ser la misma. El límite
    // de intentos lo aplica Supabase Auth, igual que en el acceso normal.
    console.error("[kiosco] QR rechazado:", error.message);
    return fallo("qr-caducado");
  }

  return NextResponse.redirect(new URL("/kiosco", request.url), { status: 303 });
}
