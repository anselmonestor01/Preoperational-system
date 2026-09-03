// Guardia de la consola de plataforma.
//
// La consola no es "el panel con más permisos": es otro edificio. Para entrar
// hacen falta DOS cosas a la vez y ninguna sirve por separado:
//
//   1. Una sesión de Supabase de un usuario con rol superadmin.
//   2. Una sesión de consola vigente, canjeada con la clave de consola.
//
// El identificador de la sesión de consola viaja en una cookie httpOnly: el
// JavaScript de la página nunca lo ve, así que un XSS no lo puede robar. Y como
// la base ata ese identificador al usuario que lo pidió, la cookie sola tampoco
// vale: haría falta robar además la sesión de correo del mismo dueño.
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export const COOKIE_CONSOLA = "ps_consola";
export const HORAS_DE_SESION = 8;

// Opciones de la cookie. `sameSite: strict` es deliberado: a la consola se
// entra escribiendo su dirección, nunca siguiendo un enlace de otro sitio, así
// que no hay flujo legítimo que se rompa y sí un vector menos.
export const OPCIONES_COOKIE = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: HORAS_DE_SESION * 3600,
};

/**
 * Quién es el superadministrador, o corta la petición.
 *
 * A quien no es superadministrador se le responde 404, no 403: para un
 * administrador de una empresa cliente la consola sencillamente no existe.
 */
export async function requireSuperadmin(): Promise<Profile> {
  const perfil = await getProfile();
  if (!perfil) redirect("/login");
  if (!perfil.is_superadmin) notFound();
  return perfil;
}

/** Igual que la anterior, pero además exige la clave de consola ya canjeada. */
export async function requireConsola(): Promise<Profile> {
  const perfil = await requireSuperadmin();
  const token = cookies().get(COOKIE_CONSOLA)?.value;
  if (!token) redirect("/consola/acceso");

  const supabase = createClient();
  const { data, error } = await supabase.rpc("console_session_valid", { p_token: token });
  if (error) {
    console.error("[consola] no se pudo validar la sesión de consola:", error.message);
    redirect("/consola/acceso");
  }
  if (data !== true) redirect("/consola/acceso");
  return perfil;
}
