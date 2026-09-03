// Ruta `/login`: si ya hay sesión activa redirige; si no, muestra el formulario.
import { redirect } from "next/navigation";
import { getProfile, roleHome } from "@/lib/auth";
import LoginForm from "./login-form";

// Un QR que no funciona aterriza aquí. Sin explicación, el conductor ve un
// formulario de acceso que no puede rellenar y se queda parado en la portería;
// con ella sabe a quién avisar.
const MOTIVOS: Record<string, string> = {
  "qr-invalido":
    "Ese código QR no es válido. Pide al administrador que imprima el cartel actualizado.",
  "qr-caducado":
    "Ese cartel ya no sirve: se generó un código nuevo. Pide al administrador el cartel actualizado.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { motivo?: string };
}) {
  const profile = await getProfile();
  if (profile) redirect(roleHome(profile.role));
  const aviso = searchParams?.motivo ? MOTIVOS[searchParams.motivo] ?? null : null;
  return <LoginForm aviso={aviso} />;
}
