"use client";

// Ajuste de la foto de perfil antes de subirla.
//
// Por qué existe: una foto de celular es rectangular y el avatar es un círculo.
// Sin ajuste, el recorte automático corta por el centro y suele dejar al
// conductor descentrado o sin cabeza. Aquí la persona encuadra su propia foto.
//
// El resultado se entrega ya recortado y cuadrado, así que lo que se sube es
// exactamente lo que se vio en pantalla.

import { useCallback, useEffect, useRef, useState } from "react";

/** Lado del lienzo de salida, en píxeles. */
const SALIDA = 512;

type Props = {
  archivo: File;
  onCancelar: () => void;
  onListo: (recorte: File) => void;
};

export default function PhotoCropper({ archivo, onCancelar, onListo }: Props) {
  const [url, setUrl] = useState<string>("");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [procesando, setProcesando] = useState(false);
  const arrastre = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const marcoRef = useRef<HTMLDivElement | null>(null);

  // Cargar la imagen elegida.
  useEffect(() => {
    const u = URL.createObjectURL(archivo);
    setUrl(u);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = u;
    return () => URL.revokeObjectURL(u);
  }, [archivo]);

  // Zoom mínimo: el que hace que la imagen cubra el marco por completo, para
  // que nunca queden bordes vacíos alrededor del recorte.
  const zoomMin = img ? Math.max(1, 1) : 1;

  const mover = useCallback((dx: number, dy: number) => {
    setPos((p) => ({ x: p.x + dx, y: p.y + dy }));
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    arrastre.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const a = arrastre.current;
    if (!a) return;
    setPos({ x: a.px + (e.clientX - a.x), y: a.py + (e.clientY - a.y) });
  }
  function onPointerUp() { arrastre.current = null; }

  function centrar() { setPos({ x: 0, y: 0 }); setZoom(1); }

  /**
   * Reproduce en un lienzo el mismo encuadre que se ve en pantalla.
   * La clave es usar la misma proporción marco↔imagen que usa el CSS
   * (`object-fit: cover`), para que lo recortado coincida con lo visto.
   */
  async function aplicar() {
    if (!img || !marcoRef.current) return;
    setProcesando(true);
    try {
      const marco = marcoRef.current.getBoundingClientRect();
      const lado = Math.min(marco.width, marco.height);

      // Escala con la que el navegador dibuja la imagen dentro del marco.
      const cover = Math.max(lado / img.width, lado / img.height) * zoom;
      const anchoMostrado = img.width * cover;
      const altoMostrado = img.height * cover;

      // Esquina superior izquierda de la imagen respecto del marco.
      const izq = (lado - anchoMostrado) / 2 + pos.x;
      const arr = (lado - altoMostrado) / 2 + pos.y;

      const canvas = document.createElement("canvas");
      canvas.width = SALIDA;
      canvas.height = SALIDA;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("sin lienzo");

      // Fondo blanco: si la imagen tiene transparencia, el JPEG la vería negra.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, SALIDA, SALIDA);

      const k = SALIDA / lado;
      ctx.drawImage(img, izq * k, arr * k, anchoMostrado * k, altoMostrado * k);

      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
      if (!blob) throw new Error("sin recorte");

      onListo(new File([blob], "foto.jpg", { type: "image/jpeg", lastModified: Date.now() }));
    } catch {
      // Ante cualquier fallo se sube el original: nunca se pierde la foto.
      onListo(archivo);
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="sheet" style={{ maxWidth: 420 }}>
        <div className="sheet-head">
          <div>
            <div className="sheet-title">Ajustar la foto</div>
            <div className="cell-sub">Arrastra para encuadrar y usa el control para acercar.</div>
          </div>
          <button className="sheet-close" onClick={onCancelar} aria-label="Cancelar">✕</button>
        </div>

        <div
          ref={marcoRef}
          className="cropper-frame"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url && (
            <img
              src={url}
              alt=""
              draggable={false}
              className="cropper-img"
              style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})` }}
            />
          )}
          {/* Guía circular: muestra exactamente lo que se verá como avatar. */}
          <div className="cropper-mask" aria-hidden="true" />
        </div>

        <div className="cropper-controls">
          <span className="cell-sub">Acercar</span>
          <input
            type="range" min={zoomMin} max={3} step={0.01} value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Nivel de acercamiento"
          />
          <button className="btn btn-ghost btn-sm" onClick={centrar}>Centrar</button>
        </div>

        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
          <button className="btn btn-primary" disabled={!img || procesando} onClick={aplicar}>
            {procesando ? "Recortando…" : "Usar esta foto"}
          </button>
        </div>
      </div>
    </div>
  );
}
