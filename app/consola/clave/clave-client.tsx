"use client";

// Cambiar la clave de consola.
//
// Cambiarla cierra TODAS las consolas abiertas en cualquier equipo. Es el único
// botón de pánico que existe si un portátil se pierde, así que se dice en la
// pantalla en lugar de esconderlo.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ClaveClient() {
  const router = useRouter();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const largoOk = nueva.length >= 12;
  const mezclaOk = /[a-zA-Z]/.test(nueva) && /[0-9]/.test(nueva);
  const coincide = nueva === repetir;
  const puede = actual.length > 0 && largoOk && mezclaOk && coincide;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!puede || busy) return;
    setBusy(true); setError(""); setOk("");
    try {
      const r = await fetch("/api/consola/clave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual, nueva }),
      });
      const j = (await r.json()) as { ok?: boolean; mensaje?: string; reabierta?: boolean };
      if (!r.ok || !j.ok) {
        setError(j.mensaje ?? "No fue posible guardar la clave.");
        setBusy(false);
        return;
      }
      setActual(""); setNueva(""); setRepetir("");
      setBusy(false);
      if (j.reabierta) {
        setOk("Clave cambiada. Las demás consolas abiertas quedaron cerradas.");
        router.refresh();
      } else {
        // La base cerró todas las sesiones y no se pudo reabrir la de aquí.
        window.location.href = "/consola/acceso";
      }
    } catch {
      setError("Problema de conexión. Verifica tu red e intenta de nuevo.");
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="c-titulo">Clave de consola</h1>
      <p className="c-sub">
        Es independiente de tu contraseña de correo. Cambiarla cierra la consola
        en todos los equipos donde esté abierta, incluido este si algo falla.
      </p>

      <div className="c-bloque" style={{ maxWidth: 460 }}>
        <div className="c-bloque-head">
          <div>
            <div className="c-bloque-titulo">Cambiar</div>
            <div className="c-bloque-sub">Mínimo 12 caracteres, con letras y números.</div>
          </div>
        </div>
        <form className="c-bloque-cuerpo" onSubmit={guardar}>
          {error && <div className="c-error">{error}</div>}
          {ok && <div className="c-aviso">{ok}</div>}

          <div className="c-campo">
            <label htmlFor="actual">Clave actual</label>
            <input id="actual" type="password" className="c-input mono" autoComplete="current-password"
              value={actual} onChange={(e) => setActual(e.target.value)} />
          </div>
          <div className="c-campo">
            <label htmlFor="nueva">Nueva clave</label>
            <input id="nueva" type="password" className="c-input mono" autoComplete="new-password"
              value={nueva} onChange={(e) => setNueva(e.target.value)} />
          </div>
          {nueva.length > 0 && !largoOk && (
            <div className="c-pista c-mal">Te faltan {12 - nueva.length} caracteres.</div>
          )}
          {largoOk && !mezclaOk && (
            <div className="c-pista c-mal">Combina letras y números.</div>
          )}
          <div className="c-campo">
            <label htmlFor="repetir">Repite la nueva clave</label>
            <input id="repetir" type="password" className="c-input mono" autoComplete="new-password"
              value={repetir} onChange={(e) => setRepetir(e.target.value)} />
          </div>
          {repetir.length > 0 && !coincide && (
            <div className="c-pista c-mal">Las dos claves no coinciden.</div>
          )}

          <button type="submit" className="c-btn" disabled={!puede || busy}>
            {busy ? "Guardando…" : "Cambiar clave"}
          </button>
        </form>
      </div>
    </>
  );
}
