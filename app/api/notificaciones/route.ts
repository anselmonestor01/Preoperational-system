// Envío de los avisos encolados (recordatorio de registrar el regreso).
//
// CÓMO FUNCIONA
// La inspección NO envía el mensaje: lo deja en la tabla `notifications`. Este
// endpoint lee lo pendiente y lo envía. Si el proveedor está caído, se reintenta
// después y ninguna inspección se ve afectada. Es el patrón "bandeja de salida".
//
// CÓMO SE DISPARA
// Con una petición POST protegida por un secreto compartido. Puede llamarse
// desde un cron de Vercel, una tarea programada o incluso a mano.
//
// QUÉ HACE FALTA PARA QUE ENVÍE DE VERDAD
// WhatsApp no permite enviar mensajes a cualquiera desde una cuenta normal:
// exige una cuenta de WhatsApp Business API y plantillas aprobadas por Meta.
// Configura estas variables de entorno EN EL SERVIDOR (nunca NEXT_PUBLIC_):
//
//   NOTIFY_SECRET          Secreto que autoriza a llamar este endpoint
//   WHATSAPP_TOKEN         Token permanente de la app de Meta
//   WHATSAPP_PHONE_ID      Identificador del número remitente
//
// Sin esas variables el endpoint NO falla: informa que no está configurado y
// deja los mensajes en cola, para que se envíen cuando se configure.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/** Máximo de mensajes por ejecución, para no agotar el tiempo de la función. */
const LOTE = 20;
/** Tras estos intentos se deja de reintentar y queda marcado como fallido. */
const MAX_INTENTOS = 5;

export async function POST(request: Request) {
  const secreto = process.env.NOTIFY_SECRET;
  const servicio = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secreto || !servicio) {
    return NextResponse.json(
      { ok: false, motivo: "El servidor no tiene configurado NOTIFY_SECRET o la clave de servicio." },
      { status: 503 },
    );
  }

  // Autorización por secreto compartido: sin esto, cualquiera podría disparar
  // envíos masivos usando el sistema como plataforma de spam.
  const cabecera = request.headers.get("authorization") ?? "";
  if (cabecera !== `Bearer ${secreto}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // La clave de servicio sólo se usa aquí, en el servidor: nunca llega al
  // navegador. Es necesaria porque este proceso no actúa como ningún usuario.
  const db = createClient(SUPABASE_URL, servicio, { auth: { persistSession: false } });

  const { data: pendientes, error } = await db
    .from("notifications")
    .select("id,destinatario,mensaje,intentos")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true })
    .limit(LOTE);

  if (error) {
    return NextResponse.json({ ok: false, motivo: error.message }, { status: 500 });
  }
  if (!pendientes?.length) {
    return NextResponse.json({ ok: true, enviados: 0, mensaje: "No hay avisos pendientes." });
  }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    return NextResponse.json({
      ok: false,
      pendientes: pendientes.length,
      motivo:
        "WhatsApp no está configurado (faltan WHATSAPP_TOKEN y WHATSAPP_PHONE_ID). " +
        "Los avisos siguen en cola y se enviarán al configurarlo.",
    }, { status: 503 });
  }

  let enviados = 0;
  let fallidos = 0;

  for (const n of pendientes) {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: soloDigitosTelefono(n.destinatario),
          type: "text",
          text: { body: n.mensaje },
        }),
      });

      if (r.ok) {
        await db.from("notifications")
          .update({ estado: "enviado", enviado_at: new Date().toISOString() })
          .eq("id", n.id);
        enviados++;
      } else {
        const detalle = (await r.text()).slice(0, 400);
        const intentos = (n.intentos ?? 0) + 1;
        await db.from("notifications").update({
          intentos,
          ultimo_error: detalle,
          // Se deja de reintentar cuando ya no tiene sentido insistir.
          estado: intentos >= MAX_INTENTOS ? "fallido" : "pendiente",
        }).eq("id", n.id);
        fallidos++;
      }
    } catch (e) {
      const intentos = (n.intentos ?? 0) + 1;
      await db.from("notifications").update({
        intentos,
        ultimo_error: String((e as Error)?.message ?? e).slice(0, 400),
        estado: intentos >= MAX_INTENTOS ? "fallido" : "pendiente",
      }).eq("id", n.id);
      fallidos++;
    }
  }

  return NextResponse.json({ ok: true, enviados, fallidos });
}

/** WhatsApp espera el número sin espacios ni símbolos. */
function soloDigitosTelefono(v: string): string {
  return (v ?? "").replace(/\D+/g, "");
}
