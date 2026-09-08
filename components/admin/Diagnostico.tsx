"use client";

/* =========================================================================
   DIAGNÓSTICO EN LA MÁQUINA QUE IMPORTA
   -------------------------------------------------------------------------
   Llevo cuatro rondas midiendo el rendimiento en un Chromium de servidor y
   dando cifras de 60 fps mientras el usuario ve lo contrario. La conclusión
   honesta es que mi banco no reproduce su máquina, así que la medición tiene
   que hacerse allí.

   Dos interruptores por URL, que se recuerdan:

   ?medir=1    enseña un recuadro con los fotogramas por segundo reales, el
               peor fotograma, y —lo importante— QUÉ está dibujando el
               navegador. Si ahí pone «SwiftShader» o «Software», el navegador
               está pintando por CPU: ningún desenfoque, sombra ni animación
               sale gratis, y eso explicaría que todo se sienta pastoso por
               muy optimizado que esté el CSS.

   ?liviano=1  apaga de golpe TODA la decoración: animaciones, transiciones,
               desenfoques, sombras y degradados. Si con esto va fluido, el
               problema es el adorno y lo quito de raíz. Si sigue igual, el
               problema no está en el CSS y hay que buscarlo en otro sitio.

   Se apagan con ?medir=0 y ?liviano=0.
   ========================================================================= */

import { useEffect, useState } from "react";

/** Lee un interruptor de la URL y lo recuerda entre navegaciones. */
function interruptor(nombre: string): boolean {
  let valor = false;
  try {
    const enUrl = new URL(window.location.href).searchParams.get(nombre);
    if (enUrl === "1" || enUrl === "0") {
      valor = enUrl === "1";
      localStorage.setItem(`diag:${nombre}`, enUrl);
    } else {
      valor = localStorage.getItem(`diag:${nombre}`) === "1";
    }
  } catch {
    /* almacenamiento bloqueado: se queda apagado */
  }
  return valor;
}

/** Qué está dibujando de verdad el navegador. La respuesta suele ser el final
 *  de la discusión: si es software, no hay CSS que arregle esto. */
function pintadoPor(): string {
  try {
    const lienzo = document.createElement("canvas");
    const gl = (lienzo.getContext("webgl2") ?? lienzo.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "sin WebGL (probable dibujado por software)";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const nombre = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    return nombre || "desconocido";
  } catch {
    return "no se pudo leer";
  }
}

export default function Diagnostico() {
  const [medir, setMedir] = useState(false);
  const [datos, setDatos] = useState({ fps: 0, peor: 0 });
  const [equipo, setEquipo] = useState({ pintor: "", dpr: 0, nucleos: 0, ancho: 0, alto: 0 });

  useEffect(() => {
    document.documentElement.toggleAttribute("data-liviano", interruptor("liviano"));
    const activo = interruptor("medir");
    setMedir(activo);
    if (!activo) return;

    setEquipo({
      pintor: pintadoPor(),
      dpr: window.devicePixelRatio,
      nucleos: navigator.hardwareConcurrency ?? 0,
      ancho: window.innerWidth,
      alto: window.innerHeight,
    });

    let vivo = true;
    let previo = performance.now();
    let cuenta = 0;
    let desde = previo;
    let peor = 0;

    const paso = () => {
      if (!vivo) return;
      const ahora = performance.now();
      const salto = ahora - previo;
      previo = ahora;
      if (salto > peor) peor = salto;
      cuenta++;
      if (ahora - desde >= 500) {
        setDatos({ fps: Math.round((cuenta * 1000) / (ahora - desde)), peor: Math.round(peor) });
        cuenta = 0;
        desde = ahora;
        peor = 0;
      }
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
    return () => { vivo = false; };
  }, []);

  if (!medir) return null;

  const flojo = datos.fps > 0 && datos.fps < 45;
  const software = /swiftshader|software|llvmpipe|basic render/i.test(equipo.pintor);
  const texto =
    `fps ${datos.fps} · peor ${datos.peor} ms · dibuja: ${equipo.pintor} · ` +
    `zoom ${equipo.dpr} · ${equipo.nucleos} núcleos · ${equipo.ancho}x${equipo.alto}`;

  return (
    <div className="medidor-diag" data-flojo={flojo || software ? "si" : undefined}>
      <div className="medidor-cifra">{datos.fps} fps</div>
      <div className="medidor-linea">peor fotograma <b>{datos.peor} ms</b></div>
      <div className="medidor-linea">
        dibuja <b>{equipo.pintor || "…"}</b>
        {software && <span className="medidor-alerta"> ← por software, ese es el problema</span>}
      </div>
      <div className="medidor-linea">
        zoom {equipo.dpr} · {equipo.nucleos} núcleos · {equipo.ancho}×{equipo.alto}
      </div>
      <button
        className="medidor-copiar"
        onClick={() => { navigator.clipboard?.writeText(texto); }}
      >
        Copiar para mandármelo
      </button>
    </div>
  );
}
