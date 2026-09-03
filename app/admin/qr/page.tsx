// Acceso al kiosco por código QR.
//
// EL PROBLEMA QUE RESUELVE
// Cada mañana el conductor llega al patio y tiene que abrir el kiosco. Teclear
// una dirección en un teléfono, con guantes y de pie, es donde se pierde el
// tiempo y donde aparecen los errores. Un cartel con un QR pegado en la
// portería lo reduce a apuntar la cámara.
//
// QUÉ CONTIENE EL CÓDIGO
// El QR lleva el identificador de la empresa y un token de acceso. Escanearlo
// abre el kiosco directamente, sin pantalla de acceso.
//
// POR QUÉ CAMBIÓ RESPECTO A LA PRIMERA VERSIÓN
// Antes el QR llevaba sólo la dirección, sin credencial, dando por supuesto que
// el kiosco es la tableta del patio con la sesión abierta una vez. El uso real
// es otro: los conductores escanean con SU PROPIO teléfono, y ahí pedir el
// correo y la contraseña del operador obligaría a repartir esa contraseña entre
// todos ellos —mucho peor que lo que este cambio arriesga.
//
// EL COMPROMISO, DICHO SIN ADORNOS
// El cartel ES una credencial. Quien lo fotografíe puede abrir el kiosco de
// esta empresa y ver la lista de conductores y las placas. Lo que NO puede es
// registrar nada: para eso hace falta el PIN personal del conductor, que no
// está en ningún cartel. Y el token es rotable: si un cartel se filtra, se
// genera otro aquí mismo y el anterior deja de servir en el acto.
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import PrintButton from "./print-button";
import RotarAcceso from "./rotar-acceso";
import Logo from "@/components/brand/Logo";
import { fmtDateTime } from "@/lib/format";

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
  // La empresa activa, no "la primera": con varias, `limit(1)` traía otra.
  const perfil = await getProfile();
  const { data: org } = await supabase
    .from("organizations").select("name,slug")
    .eq("id", perfil?.organization_id ?? "").maybeSingle();

  const { data: acceso, error: errorAcceso } = await supabase.rpc("kiosk_access_token");
  const a = (acceso ?? {}) as { configurado?: boolean; token?: string; rotado_en?: string };
  const listo = a.configurado === true && !!a.token && !!org?.slug;

  // Sin token no se dibuja un cartel: uno que no abre nada es peor que ninguno,
  // porque alguien lo imprime y lo pega antes de descubrirlo.
  const url = listo
    ? `${baseUrl()}/api/kiosco/entrar?e=${encodeURIComponent(org!.slug)}&k=${encodeURIComponent(a.token!)}`
    : null;

  // Corrección de errores alta: el cartel va a vivir a la intemperie, con polvo
  // y roces. Con nivel "H" el código sigue leyéndose con hasta un 30% dañado.
  const svg = url
    ? await QRCode.toString(url, {
        type: "svg",
        errorCorrectionLevel: "H",
        margin: 0,
        color: { dark: "#0B2545", light: "#FFFFFF" },
      })
    : null;

  return (
    <>
      <div className="panel no-print">
        <div className="panel-head">
          <div>
            <div className="panel-title">Acceso rápido al kiosco</div>
            <div className="panel-sub">
              Imprime el cartel y pégalo en la portería. Los conductores apuntan la cámara y entran
              directo, sin iniciar sesión.
            </div>
          </div>
          {listo && <PrintButton />}
        </div>

        {errorAcceso && (
          <div className="err-box" style={{ marginBottom: 12 }}>
            No se pudo leer el acceso del kiosco: {errorAcceso.message}
          </div>
        )}

        <ol className="qr-steps">
          <li>
            <strong>Genera el acceso una vez.</strong> Crea el código que abre el kiosco de esta
            empresa. No hace falta preparar ningún dispositivo ni repartir contraseñas.
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
          <strong>Este cartel abre el kiosco: trátalo como una llave.</strong> Quien lo fotografíe
          puede ver la lista de conductores y las placas de esta empresa. Lo que no puede es
          registrar nada, porque para eso hace falta el PIN personal del conductor. Si un cartel se
          pierde o se filtra, genera uno nuevo aquí: el anterior deja de funcionar en el acto.
        </div>

        <RotarAcceso
          configurado={a.configurado === true}
          rotadoEn={a.rotado_en ? fmtDateTime(a.rotado_en) : null}
        />
      </div>

      {/* El cartel. Es lo único que sale al imprimir. */}
      {listo && svg && (
        <div className="qr-poster">
          <div className="qr-poster-brand">
            <Logo size={76} />
            <span><span className="l1">PREOPERATIONAL </span><span className="l2">SYSTEM</span></span>
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
          {/* La dirección NO se imprime: lleva el token, y un cartel legible a
              máquina no tiene por qué serlo también a simple vista. */}
        </div>
      )}
    </>
  );
}
