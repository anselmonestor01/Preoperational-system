// Acceso al kiosco por código QR.
//
// EL PROBLEMA QUE RESUELVE
// Cada mañana el conductor llega al patio y tiene que abrir el kiosco. Teclear
// una dirección en un teléfono, con guantes y de pie, es donde se pierde el
// tiempo y donde aparecen los errores. Un cartel con un QR pegado en la
// portería lo reduce a apuntar la cámara.
//
// QUÉ CONTIENE EL CÓDIGO (Y QUÉ NO)
// El QR contiene ÚNICAMENTE la dirección del kiosco. No lleva ninguna clave,
// ningún token ni ninguna sesión: fotografiar el cartel no da acceso a nada.
// Quien escanee sigue necesitando que el dispositivo tenga sesión abierta, y
// además su PIN personal para usar su perfil de conductor.
//
// Se evaluó meter un token de acceso en el QR para que cualquier teléfono
// entrara sin iniciar sesión, y se descartó: un cartel a la vista de todos
// habría sido, en la práctica, una contraseña pegada a la pared. La tableta del
// patio se deja con la sesión iniciada una sola vez y el QR la abre en el sitio
// correcto; ése es el uso real y no debilita nada.

import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";

/** Dirección pública de esta instalación, tal como la ve un teléfono. */
function baseUrl(): string {
  const h = headers();
  // `x-forwarded-*` los pone el proxy de Vercel; en local caen a los valores
  // del propio servidor.
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function QrPage() {
  const supabase = createClient();
  const { data: org } = await supabase
    .from("organizations").select("name").limit(1).maybeSingle();

  const url = `${baseUrl()}/kiosco`;

  // Corrección de errores alta: el cartel va a vivir a la intemperie, con polvo
  // y roces. Con nivel "H" el código sigue leyéndose con hasta un 30% dañado.
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 0,
    color: { dark: "#0B2545", light: "#FFFFFF" },
  });

  return (
    <>
      <div className="panel no-print">
        <div className="panel-head">
          <div>
            <div className="panel-title">Acceso rápido al kiosco</div>
            <div className="panel-sub">
              Imprime el cartel y pégalo en la portería. Los conductores apuntan la cámara y entran.
            </div>
          </div>
          <PrintButton />
        </div>

        <ol className="qr-steps">
          <li>
            <strong>Prepara el dispositivo del patio una sola vez.</strong> Inicia sesión con la
            cuenta de operador en la tableta o el teléfono que se queda en la portería. La sesión
            queda guardada en ese equipo.
          </li>
          <li>
            <strong>Imprime y pega el cartel.</strong> A tamaño carta se lee sin problema desde
            medio metro.
          </li>
          <li>
            <strong>Cada mañana:</strong> el conductor escanea, elige su nombre, escribe su PIN de
            4 dígitos y hace la inspección.
          </li>
        </ol>

        <div className="qr-note">
          <strong>El código no contiene ninguna clave.</strong> Sólo lleva la dirección del sistema.
          Si alguien lo fotografía no consigue nada: seguirá necesitando una sesión iniciada en el
          dispositivo y el PIN personal del conductor.
        </div>
      </div>

      {/* El cartel. Es lo único que sale al imprimir. */}
      <div className="qr-poster">
        <div className="qr-poster-brand">
          <span className="l1">PREOPERATIONAL </span><span className="l2">SYSTEM</span>
        </div>
        <div className="qr-poster-title">Inspección preoperacional</div>
        <div className="qr-poster-sub">{org?.name ?? "Control de flota"}</div>

        <div className="qr-code" dangerouslySetInnerHTML={{ __html: svg }} />

        <div className="qr-poster-cta">Escanea para iniciar tu inspección</div>
        <ol className="qr-poster-steps">
          <li>Apunta la cámara al código</li>
          <li>Elige tu nombre</li>
          <li>Escribe tu PIN de 4 dígitos</li>
        </ol>
        <div className="qr-poster-url">{url}</div>
      </div>
    </>
  );
}
