// Middleware de sesión: protege las rutas privadas y renueva el token.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

// Protege las rutas privadas y renueva la sesión SÓLO cuando el token está
// por caducar. Ver la nota de dentro sobre por qué eso es seguro.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as any),
          );
        },
      },
    },
  );

  const path = request.nextUrl.pathname;

  // Rutas accesibles sin sesión. Recuperar y restablecer contraseña TIENEN que
  // serlo: quien llega ahí precisamente no puede iniciar sesión todavía.
  const isPublic =
    path === "/login" ||
    path === "/recuperar" ||
    path === "/restablecer" ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon") ||
    path === "/auth/callback";

  // En una ruta pública no hay nada que proteger ni que renovar: se sale antes
  // de tocar la sesión, y así /login deja de pagar el trabajo de sesión.
  if (isPublic) return response;

  // UNA LLAMADA DE RED MENOS EN CADA PETICIÓN
  // Esto llamaba a `auth.getUser()` siempre. `getUser()` no lee una cookie: es
  // una petición al servidor de Auth, y se pagaba en CADA navegación, cada
  // precarga y cada petición que case con el matcher. Con la base respondiendo
  // en 6 ms, esa ida y vuelta era de las pocas cosas que de verdad se notaban.
  //
  // `getSession()` lee y descifra la cookie en local, sin red, y trae cuándo
  // caduca el token. Mientras siga fresco no hay nada que preguntarle a nadie:
  // el token de Supabase dura una hora, así que esto evita la llamada durante
  // 59 de cada 60 minutos de uso. Sólo cuando está por caducar se llama a
  // `getUser()`, que es quien lo renueva y reescribe las cookies.
  //
  // POR QUÉ ES SEGURO
  // Este middleware decide REDIRECCIONES, no permisos. Quien firme una cookie
  // falsa pasaría este filtro, pero no el siguiente: PostgREST verifica la
  // firma y la caducidad del JWT antes de ejecutar nada, `me()` no devuelve
  // filas, el layout manda a /login y RLS no deja leer una sola fila. La
  // frontera de seguridad está en la base, como debe estar; aquí sólo se decide
  // a qué pantalla se manda a alguien.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const ahora = Math.floor(Date.now() / 1000);
  const MARGEN = 120; // segundos de colchón antes de la caducidad
  const porCaducar = !session?.expires_at || session.expires_at - MARGEN <= ahora;

  // Sólo interesa SI hay sesión, no quién es: leer `session.user` haría que el
  // SDK escupiera su aviso de «usuario no verificado» en cada petición y
  // llenara el registro. Quién es se resuelve donde importa, con el JWT ya
  // verificado: en `me()` y en RLS.
  let haySesion = !!session;
  if (session && porCaducar) {
    // Token caducado o a punto: aquí sí hay que hablar con Auth, que además lo
    // renueva y deja las cookies nuevas en la respuesta.
    const { data } = await supabase.auth.getUser();
    haySesion = !!data.user;
  }
  // Sin sesión → a login. `/consola` entra aquí igual que el panel: la clave de
  // consola es una SEGUNDA cerradura, no un sustituto del inicio de sesión, y la
  // comprueba después `requireConsola()`.
  if (
    !haySesion &&
    (path.startsWith("/admin") || path.startsWith("/kiosco") || path.startsWith("/consola"))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return response;
}
