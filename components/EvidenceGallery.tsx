"use client";

import { useCallback, useEffect, useState } from "react";

// Galería de evidencias con visor (lightbox) profesional:
// click en miniatura → modal grande, navegación entre varias, teclado, móvil.
export default function EvidenceGallery({
  urls, size = 76, empty,
}: { urls: string[]; size?: number; empty?: string }) {
  const [idx, setIdx] = useState<number | null>(null);
  const open = idx !== null;

  const close = useCallback(() => setIdx(null), []);
  const prev = useCallback(() => setIdx((i) => (i === null ? i : (i - 1 + urls.length) % urls.length)), [urls.length]);
  const next = useCallback(() => setIdx((i) => (i === null ? i : (i + 1) % urls.length)), [urls.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, prev, next]);

  if (!urls.length) {
    return empty ? <div className="cell-sub">{empty}</div> : null;
  }

  return (
    <>
      <div className="evi-grid">
        {urls.map((u, i) => (
          <img
            key={i} src={u} alt={`Evidencia ${i + 1}`} className="evi-thumb"
            style={{ width: size, height: size }} onClick={() => setIdx(i)} loading="lazy"
          />
        ))}
      </div>
      {open && (
        <div className="lightbox show" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <button className="lightbox-close" onClick={close} aria-label="Cerrar">✕</button>
          {urls.length > 1 && <button className="lightbox-nav prev" onClick={prev} aria-label="Anterior">‹</button>}
          <img src={urls[idx!]} alt={`Evidencia ${idx! + 1}`} />
          {urls.length > 1 && <button className="lightbox-nav next" onClick={next} aria-label="Siguiente">›</button>}
          {urls.length > 1 && <div className="lightbox-count">{idx! + 1} / {urls.length}</div>}
        </div>
      )}
    </>
  );
}
