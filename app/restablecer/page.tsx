// Ruta `/restablecer`: destino del enlace enviado por correo para fijar una
// contraseña nueva. Es pública a propósito: quien llega aquí todavía no puede
// iniciar sesión.
import ResetForm from "./reset-form";

export const metadata = { title: "Nueva contraseña — Preoperational System" };

export default function RestablecerPage() {
  return <ResetForm />;
}
