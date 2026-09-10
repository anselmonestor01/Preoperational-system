"use client";

/* =========================================================================
   DIAGNÓSTICO EN LA MÁQUINA QUE IMPORTA
   -------------------------------------------------------------------------
   Llevo varias rondas midiendo el rendimiento en un Chromium de servidor y
   dando cifras de 60 fps mientras el usuario ve lo contrario. Mi banco no
   reproduce su máquina, así que la medición tiene que hacerse allí.

   Dos interruptores, que se recuerdan entre navegaciones:

   medidor    Enseña los fotogramas por segundo reales, el peor fotograma y
              —lo importante— QUÉ está dibujando el navegador. Si ahí pone
              SwiftShader, llvmpipe o «software», el navegador pinta por CPU:
              ningún desenfoque, sombra ni animación sale gratis, y eso
              explicaría que todo se sienta pastoso por muy afinado que esté
              el CSS. Eso no se arregla desde el código.

   liviano    Apaga de golpe TODA la decoración: animaciones, transiciones,
              desenfoques, sombras, filtros y degradados. Parte el problema en
              dos: si con esto va fluido, el adorno es el culpable; si sigue
              igual, el problema no está en el CSS.

   Se encienden de dos maneras, porque editar una URL a mano se falla:
     · por teclado   Ctrl+Shift+M (medidor)   Ctrl+Shift+L (liviano)
     · por URL       ?medir=1  ?liviano=1     (y con =0 se apagan)
   ========================================================================= */

import { useCallback, useEffect, useState } from "react";

const CLAVE = (nombre: string) => `diag:${nombre}`;

/** Lee un interruptor: manda la URL si trae el parámetro, si no lo recordado. */
function leer(nombre: string): boolean {
  try {
    const enUrl = new URL(window.location.href).searchParams.get(nombre);
    if (enUrl === "1" || enUrl === "0") {
      localStorage.setItem(CLAVE(nombre), enUrl);
      return enUrl === "1";
    }
    return localStorage.getItem(CLAVE(nombre)) === "1";
  } catch {
    return false; // almacenamiento bloqueado: se queda apagado
  }
}

function guardar(nombre: string, valor: boolean) {
  try { localStorage.setItem(CLAVE(nombre), valor ? "1" : "0"); } catch { /* da igual */ }
}

/** Qué está dibujando de verdad el navegador. Suele ser el final de la
 *  discusión: si es software, no hay CSS que arregle esto. */
function pintadoPor(): string {
  try {
    const lienzo = document.createElement("canvas");
    const gl = (lienzo.getContext("webgl2") ?? lienzo.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "sin WebGL (dibujado por software)";
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

  const cambiarLiviano = useCallback((valor: boolean) => {
    document.documentElement.toggleAttribute("data-liviano", valor);
    guardar("liviano", valor);
  }, []);

  // --- interruptores: URL al cargar, teclado en cualquier momento ---------
  useEffect(() => {
    cambiarLiviano(leer("liviano"));
    setMedir(leer("medir"));

    const tecla = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "m") {
        e.preventDefault();
        setMedir((v) => { guardar("medir", !v); return !v; });
      } else if (k === "l") {
        e.preventDefault();
        cambiarLiviano(!document.documentElement.hasAttribute("data-liviano"));
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cambiarLiviano]);

  // --- el contador sólo corre mientras se mira ----------------------------
  useEffect(() => {
    if (!medir) return;

    setEquipo({
      pintor: pintadoPor(),
      dpr: window.devicePixelRatio,
      nucleos: navigator.hardwareConcurrency ?? 0,
      ancho: window.innerWidth,
      alto: window.innerHeight,
    });

    let vivo = true;
    let previo = performance.now();
    let desde = previo;
    let cuenta = 0;
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
        cuenta = 0; desde = ahora; peor = 0;
      }
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
    return () => { vivo = false; };
  }, [medir]);

  if (!medir) return null;

  const software = /swiftshader|software|llvmpipe|basic render|sin webgl/i.test(equipo.pintor);
  const flojo = datos.fps > 0 && datos.fps < 45;
  const linea =
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
      <button className="medidor-copiar" onClick={() => navigator.clipboard?.writeText(linea)}>
        Copiar para mandármelo
      </button>
      <div className="medidor-pie">Ctrl+Shift+M lo cierra · Ctrl+Shift+L apaga la decoración</div>
    </div>
  );
}
