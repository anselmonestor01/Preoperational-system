// Ruta `/kiosco`: valida sesión y rol antes de montar la app del conductor.
import { redirect } from "next/navigation";
import { getProfile, KIOSK_ROLES } from "@/lib/auth";
import KioskApp from "./kiosk-app";

export const dynamic = "force-dynamic";

// Sólo el dispositivo de kiosco entra aquí. Antes bastaba con tener sesión, de
// modo que un auditor (rol de sólo lectura) podía abrir el kiosco escribiendo
// /kiosco en la barra de direcciones y registrar inspecciones.
//
// La separación es deliberada: el kiosco es el aparato del patio, inicia sesión
// una vez como operador y son los conductores quienes se identifican con su PIN.
// Que un administrador pudiera inspeccionar desde su propia sesión rompería esa
// cadena de responsabilidad, que es justamente lo que el PIN existe para probar.
export default async function KioscoPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!KIOSK_ROLES.includes(profile.role)) redirect("/admin");
  return <KioskApp profileName={profile.full_name} orgId={profile.organization_id} />;
}
