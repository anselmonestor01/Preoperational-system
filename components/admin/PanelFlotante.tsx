"use client";

/* =========================================================================
   PANELES FLOTANTES
   -------------------------------------------------------------------------
   Un modal que ocupa media pantalla y tapa justo el dato que uno estaba
   mirando obliga a cerrarlo, mirar, y volver a abrirlo. Aquí el diálogo pasa
   a comportarse como una ventana: nace pequeño y centrado, y se arrastra por
   su cabecera a donde estorbe menos.

   Tres arreglos en uno:

   1. ABRE ARRIBA. Cuando un campo con autoFocus quedaba por debajo del pliegue,
      el navegador desplazaba el contenedor con scroll —el propio modal— para
      traerlo a la vista, y el panel aparecía ya rodado hacia abajo. Durante los
      primeros 400 ms se devuelve el scroll a cero; después el usuario manda.

   2. SE ARRASTRA. La cabecera es el asa. Se usa la propiedad `translate`, no
      `transform`, para no pelear con la animación de entrada, y se fija
      únicamente cuando de verdad se ha movido: un modal sin tocar conserva
      exactamente el comportamiento de antes (sin bloque contenedor nuevo).

   3. NO SE ESCAPA. La posición se recorta contra la ventana, así que el panel
      no puede quedar fuera de alcance. Si es más alto que la pantalla, el
      recorte se invierte para poder subirlo y leer el final.

   Debajo de 760 px no se arrastra nada: ahí el diálogo es una hoja que sube
   desde abajo, que es lo correcto con el pulgar.
   ========================================================================= */

import { useEffect } from "react";

const ANCHO_MINIMO = 760;
const MARGEN = 10;

function limitar(v: number, a: number, b: number) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return v < lo ? lo : v > hi ? hi : v;
}

export default function PanelFlotante() {
  useEffect(() => {
    const limpiezas: Array<() => void> = [];

    function preparar(sheet: HTMLElement) {
      if (sheet.dataset.flotante === "si") return;
      sheet.dataset.flotante = "si";

      // --- 1. que abra por arriba -----------------------------------------
      const alTope = () => { sheet.scrollTop = 0; };
      alTope();
      requestAnimationFrame(alTope);
      sheet.addEventListener("focusin", alTope);
      const soltar = window.setTimeout(() => sheet.removeEventListener("focusin", alTope), 400);
      limpiezas.push(() => { window.clearTimeout(soltar); sheet.removeEventListener("focusin", alTope); });

      // --- 2. el asa -------------------------------------------------------
      const asa = sheet.querySelector<HTMLElement>(".sheet-head");
      if (!asa) return;
      asa.classList.add("asa-panel");
      const capa = sheet.closest<HTMLElement>(".overlay");

      let x = 0, y = 0;             // desplazamiento aplicado
      let px = 0, py = 0;           // origen del puntero
      let x0 = 0, y0 = 0;           // desplazamiento al empezar
      let libreX = [0, 0];
      let libreY = [0, 0];
      let idPuntero: number | null = null;

      const aplicar = () => { sheet.style.translate = `${x}px ${y}px`; };

      const mover = (e: PointerEvent) => {
        if (idPuntero === null) return;
        x = limitar(x0 + (e.clientX - px), libreX[0], libreX[1]);
        y = limitar(y0 + (e.clientY - py), libreY[0], libreY[1]);
        aplicar();
      };

      const terminar = (e: PointerEvent) => {
        if (idPuntero === null) return;
        idPuntero = null;
        sheet.removeAttribute("data-arrastrando");
        capa?.removeAttribute("data-arrastrando");
        try { asa.releasePointerCapture(e.pointerId); } catch { /* ya soltado */ }
      };

      const empezar = (e: PointerEvent) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        if (window.innerWidth < ANCHO_MINIMO) return;
        const dentro = e.target as HTMLElement | null;
        // El botón de cerrar y cualquier control siguen siendo controles.
        if (dentro?.closest("button, a, input, textarea, select, [role='button']")) return;

        const r = sheet.getBoundingClientRect();
        const izq = r.left - x;   // posición natural, sin el desplazamiento
        const arr = r.top - y;
        libreX = [MARGEN - izq, window.innerWidth - MARGEN - r.width - izq];
        libreY = [MARGEN - arr, window.innerHeight - MARGEN - r.height - arr];

        idPuntero = e.pointerId;
        px = e.clientX; py = e.clientY;
        x0 = x; y0 = y;
        // La animación de entrada se apaga de raíz, no por CSS: quitar una clase
        // que la anulaba la volvía a disparar al soltar el ratón y el panel
        // pegaba un salto de 24 px. Medido en el banco a 1440x900.
        sheet.style.animation = "none";
        sheet.dataset.arrastrando = "si";
        // La capa también se entera: su esmerilado de pantalla completa se
        // apaga mientras dura el arrastre (ver globals.css).
        capa?.setAttribute("data-arrastrando", "si");
        try { asa.setPointerCapture(e.pointerId); } catch { /* sin captura, igual sirve */ }
        e.preventDefault();
      };

      // Doble clic en la cabecera: vuelve al centro. Salida sin buscar el sitio.
      const centrar = () => { x = 0; y = 0; sheet.style.translate = ""; };

      asa.addEventListener("pointerdown", empezar);
      asa.addEventListener("pointermove", mover);
      asa.addEventListener("pointerup", terminar);
      asa.addEventListener("pointercancel", terminar);
      asa.addEventListener("dblclick", centrar);

      const alRedimensionar = () => { if (x || y) centrar(); };
      window.addEventListener("resize", alRedimensionar);

      limpiezas.push(() => {
        asa.removeEventListener("pointerdown", empezar);
        asa.removeEventListener("pointermove", mover);
        asa.removeEventListener("pointerup", terminar);
        asa.removeEventListener("pointercancel", terminar);
        asa.removeEventListener("dblclick", centrar);
        window.removeEventListener("resize", alRedimensionar);
      });
    }

    // El velo del pie sólo se pinta si hay algo más abajo. Se recomprueba en
    // cada tanda de cambios porque el contenido de un modal suele llegar
    // después: primero el marco, luego la consulta.
    function marcarDesborde(sheet: HTMLElement) {
      const hayMas = sheet.scrollHeight - sheet.clientHeight > 4;
      if (hayMas) sheet.dataset.desborda = "si";
      else sheet.removeAttribute("data-desborda");
    }

    let pendiente = false;
    const revisar = () => {
      pendiente = false;
      document.querySelectorAll<HTMLElement>(".overlay.show .sheet").forEach((sheet) => {
        preparar(sheet);
        marcarDesborde(sheet);
      });
    };
    const encolar = () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(revisar);
    };

    revisar();
    const observador = new MutationObserver(encolar);
    observador.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

    return () => {
      observador.disconnect();
      limpiezas.forEach((f) => f());
    };
  }, []);

  return null;
}
