"use client";

// Pedir la clave de consola, o establecerla la primera vez.
//
// La clave se envía a una ruta del propio servidor y no a Supabase desde el
// navegador. El motivo no es de estilo: lo que devuelve la base es un
// identificador de sesión que tiene que acabar en una cookie httpOnly, y eso
// sólo lo puede hacer el servidor. Así el identificador nunca pasa por la
// memoria del JavaScript de la página.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AccesoForm({
  configurada, quien,
}: { configurada: boolean; quien: string }) {
  const router = useRouter();
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const primeraVez = !configurada;
  const largoOk = clave.length >= 12;
  const mezclaOk = /[a-zA-Z]/.test(clave) && /[0-9]/.test(clave);
  const coincide = clave === repetir;
  const puede = primeraVez ? largoOk && mezclaOk && coincide : clave.length > 0;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!puede || busy) return;
    setBusy(true);
    setError("");

    const url = primeraVez ? "/api/consola/clave" : "/api/consola/abrir";
    const cuerpo = primeraVez ? { actual: null, nueva: clave } : { clave };

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = (await r.json()) as { ok?: boolean; mensaje?: string };
      if (!r.ok || !j.ok) {
        setError(j.mensaje ?? "No fue posible abrir la consola.");
        setBusy(false);
        setClave("");
        return;
      }
      router.replace("/consola");
      router.refresh();
    } catch {
      setError("Problema de conexión. Verifica tu red e intenta de nuevo.");
      setBusy(false);
    }
  }

  return (
    <div className="c-acceso">
      <form className="c-acceso-caja" onSubmit={enviar}>
        <span className="c-marca">
          <span className="c-cuadro" aria-hidden="true" />
          Plataforma <em>/ consola</em>
        </span>

        <h1>{primeraVez ? "Establece la clave de consola" : "Clave de consola"}</h1>
        <p className="intro">
          {primeraVez
            ? "Todavía no hay clave. Ponla ahora: será la segunda cerradura de la consola, independiente de tu contraseña de correo."
            : "Tu sesión ya está iniciada. Falta la segunda cerradura."}
        </p>

        {error && <div className="c-error">{error}</div>}

        <div className="c-campo">
          <label htmlFor="clave">{primeraVez ? "Nueva clave" : "Clave"}</label>
          <input
            id="clave" type="password" className="c-input mono"
            autoComplete={primeraVez ? "new-password" : "current-password"}
            autoFocus value={clave} onChange={(e) => setClave(e.target.value)}
          />
        </div>

        {primeraVez && (
          <>
            <div className="c-pista">
              Mínimo 12 caracteres, con letras y números.{" "}
              {clave.length > 0 && !largoOk && <span className="c-mal">Te faltan {12 - clave.length}.</span>}
              {largoOk && !mezclaOk && <span className="c-mal">Combina letras y números.</span>}
            </div>
            <div className="c-campo">
              <label htmlFor="repetir">Repite la clave</label>
              <input
                id="repetir" type="password" className="c-input mono"
                autoComplete="new-password"
                value={repetir} onChange={(e) => setRepetir(e.target.value)}
              />
            </div>
            {repetir.length > 0 && !coincide && (
              <div className="c-pista c-mal">Las dos claves no coinciden.</div>
            )}
          </>
        )}

        <button type="submit" className="c-btn" disabled={!puede || busy} style={{ width: "100%" }}>
          {busy ? "Comprobando…" : primeraVez ? "Guardar y entrar" : "Entrar"}
        </button>

        <div className="pie">
          Sesión de correo: {quien}<br />
          La consola se cierra sola a las 8 horas.<br />
          {!primeraVez && "5 intentos fallidos bloquean 15 minutos."}
        </div>
      </form>
    </div>
  );
}
