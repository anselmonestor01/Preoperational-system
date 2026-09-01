// Ruta `/recuperar`: solicita el correo de restablecimiento de contraseña.
import RecoverForm from "./recover-form";

export const metadata = { title: "Recuperar contraseña — Preoperational System" };

export default function RecuperarPage() {
  return <RecoverForm />;
}
