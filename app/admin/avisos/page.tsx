// Avisos: recordatorios de "registra tu regreso" pendientes de enviar.
//
// Existe una vía automática (app/api/notificaciones) que requiere una cuenta de
// WhatsApp Business API. Mientras no esté configurada, desde aquí se envían a
// mano en un toque, sin ningún costo: el enlace abre WhatsApp con el mensaje
// ya escrito. Así el recordatorio funciona desde el primer día.
import { createClient } from "@/lib/supabase/server";
import AvisosClient, { type AvisoRow } from "./avisos-client";

export const dynamic = "force-dynamic";

export default async function AvisosPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id,destinatario,mensaje,estado,intentos,created_at,enviado_at,driver_id")
    .order("created_at", { ascending: false })
    .limit(100);

  return <AvisosClient rows={(data ?? []) as AvisoRow[]} />;
}
