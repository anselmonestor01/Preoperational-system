// Segunda cerradura: la clave de consola.
//
// Si ya hay una sesión de consola vigente esta pantalla no tiene sentido, así
// que redirige a la consola en vez de pedir la clave dos veces.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSuperadmin, COOKIE_CONSOLA } from "@/lib/consola";
import { createClient } from "@/lib/supabase/server";
import AccesoForm from "./acceso-form";

export const dynamic = "force-dynamic";

export default async function AccesoPage() {
  const perfil = await requireSuperadmin();
  const supabase = createClient();

  const token = cookies().get(COOKIE_CONSOLA)?.value;
  if (token) {
    const { data } = await supabase.rpc("console_session_valid", { p_token: token });
    if (data === true) redirect("/consola");
  }

  const { data: estado } = await supabase.rpc("console_state").maybeSingle();
  const configurada = (estado as { configurada?: boolean } | null)?.configurada === true;

  return <AccesoForm configurada={configurada} quien={perfil.email} />;
}
