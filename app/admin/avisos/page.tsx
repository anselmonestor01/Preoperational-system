// Avisos: mensajes de WhatsApp hacia los conductores.
//
// Hay dos orígenes:
//  · Automáticos ("regreso"): los crea el sistema cuando un vehículo sale
//    autorizado, para recordarle al conductor que registre su regreso.
//  · Manuales ("personalizado"): los escribe un administrador desde aquí.
//
// Y dos formas de enviarlos:
//  · Enlace de WhatsApp (wa.me): funciona desde el primer día, sin cuenta de
//    empresa y sin costo. El aviso se marca como enviado con un toque.
//  · API de WhatsApp Business (app/api/notificaciones): envío automático, exige
//    cuenta de empresa y plantillas aprobadas por Meta.
//
// Mientras la segunda no esté configurada, la primera cubre la operación
// completa: por eso esta pantalla no es un respaldo, es la vía principal.
import { createClient } from "@/lib/supabase/server";
import AvisosClient, { type AvisoRow, type ConductorRow } from "./avisos-client";

export const dynamic = "force-dynamic";

export default async function AvisosPage() {
  const supabase = createClient();

  const [avisos, conductores, enRuta] = await Promise.all([
    supabase
      .from("notifications")
      .select("id,destinatario,mensaje,estado,tipo,intentos,created_at,enviado_at,driver_id,inspection_id")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("drivers")
      .select("id,full_name,whatsapp,active")
      .eq("active", true)
      .order("full_name"),
    // Conductores con una salida abierta: el administrador querrá escribirles
    // a ellos antes que a nadie.
    supabase
      .from("inspections")
      .select("driver_id,vehicle_plate,submitted_at")
      .eq("operation_status", "open")
      .not("driver_id", "is", null),
  ]);

  const enRutaPorConductor = new Map<string, { placa: string; desde: string }>();
  for (const i of enRuta.data ?? []) {
    if (i.driver_id) {
      enRutaPorConductor.set(i.driver_id, {
        placa: i.vehicle_plate ?? "",
        desde: i.submitted_at ?? "",
      });
    }
  }

  const rows = (conductores.data ?? []).map((d) => ({
    ...d,
    en_ruta: enRutaPorConductor.get(d.id) ?? null,
  })) as ConductorRow[];

  return <AvisosClient rows={(avisos.data ?? []) as AvisoRow[]} conductores={rows} />;
}
