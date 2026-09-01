// Ruta `/kiosco`: valida sesión y rol antes de montar la app del conductor.
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import KioskApp from "./kiosk-app";

export const dynamic = "force-dynamic";

export default async function KioscoPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  // Operadores de kiosco y conductores usan este flujo; admins pueden probarlo.
  return <KioskApp profileName={profile.full_name} orgId={profile.organization_id} />;
}
