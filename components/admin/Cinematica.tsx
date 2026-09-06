"use client";

// Movimiento del panel: revelado al entrar en cuadro y luz ambiental que sigue
// al puntero.
//
// POR QUÉ ASÍ Y NO CON WEBGL
// Una escena WebGL detrás de una tabla de inspecciones cuesta una capa de
// composición permanente y un bucle de render que no para: en un panel que se
// mira ocho horas seguidas eso se paga en batería, en ventiladores y en la
// fatiga que el propio usuario pidió evitar. Lo que da la sensación de escena
// —profundidad, luz direccional, paralaje— se consigue moviendo dos variables
// CSS. El navegador lo resuelve en el compositor, sin tocar el hilo principal.
//
// Todo el trabajo va dentro de un requestAnimationFrame y se apaga solo cuando
// el sistema pide menos movimiento.

import { useEffect } from "react";

export default function Cinematica() {
  useEffect(() => {
    const menos = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (menos.matches) {
      document.querySelectorAll("[data-entra]").forEach((e) => e.classList.add("en-cuadro"));
      return;
    }

    // --- revelado -------------------------------------------------------
    // Margen inferior negativo: el bloque entra cuando ya está bien dentro
    // del cuadro, no cuando asoma un píxel por el borde.
    const ojo = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("en-cuadro");
            ojo.unobserve(e.target); // se revela una vez; volver a hacerlo marea
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 },
    );
    // Qué espera y qué no: lo que ya está en pantalla al cargar entra con la
    // animación escalonada; lo que queda por debajo del pliegue espera a que
    // el scroll lo traiga. Se decide aquí y no en cada módulo para que la
    // regla sea una sola y no haya que acordarse de marcarlo en el marcado.
    const marcar = () => {
      const alto = window.innerHeight;
      document.querySelectorAll<HTMLElement>(".admin-body .panel:not([data-entra]):not(.en-cuadro)")
        .forEach((el) => {
          if (el.getBoundingClientRect().top > alto * 0.92) {
            el.setAttribute("data-entra", "");
            el.classList.add("espera-cuadro");
          }
        });
      document.querySelectorAll("[data-entra]:not(.en-cuadro)").forEach((e) => ojo.observe(e));
    };
    marcar();

    // Next repinta el cuerpo al navegar entre módulos: hay que volver a mirar.
    const mutaciones = new MutationObserver(marcar);
    const cuerpo = document.querySelector(".admin-body");
    if (cuerpo) mutaciones.observe(cuerpo, { childList: true, subtree: true });

    // --- luz que sigue al puntero ---------------------------------------
    const shell = document.querySelector<HTMLElement>(".admin-mode");
    let pedido = 0, x = 0.78, y = 0;
    const mover = (ev: PointerEvent) => {
      x = ev.clientX / window.innerWidth;
      y = ev.clientY / window.innerHeight;
      if (pedido) return;
      pedido = requestAnimationFrame(() => {
        pedido = 0;
        // Amplitud corta: la luz acompaña, no persigue. Un paralaje amplio en
        // una pantalla de trabajo distrae en lugar de situar. Son píxeles y no
        // porcentajes porque lo que se mueve es una capa con transform.
        shell?.style.setProperty("--luz-tx", `${((x - 0.5) * -90).toFixed(1)}px`);
        shell?.style.setProperty("--luz-ty", `${((y - 0.5) * 60).toFixed(1)}px`);
      });
    };
    window.addEventListener("pointermove", mover, { passive: true });

    return () => {
      ojo.disconnect();
      mutaciones.disconnect();
      window.removeEventListener("pointermove", mover);
      if (pedido) cancelAnimationFrame(pedido);
    };
  }, []);

  return null;
}
