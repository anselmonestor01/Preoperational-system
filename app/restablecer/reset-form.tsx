"use client";

// Definición de la nueva contraseña tras seguir el enlace del correo.
//
// Al abrir el enlace, Supabase deja una sesión de recuperación activa; por eso
// aquí basta con updateUser. Se cierra la sesión al terminar para obligar a
// entrar con la contraseña nueva y confirmar que quedó bien guardada.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

const MIN = 8;

export default function ResetForm() {
  const supabase = createClient();
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [listo, setListo] = useState(false);
  const [enlaceValido, setEnlaceValido] = useState<boolean | null>(null);

  // El enlace del correo abre una sesión temporal. Si no existe, el enlace ya
  // caducó o se abrió en otro navegador.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEnlaceValido(!!data.session));
  }, [supabase]);

  const corta = pw.length > 0 && pw.length < MIN;
  const noCoincide = pw2.length > 0 && pw !== pw2;
  const puedeEnviar = pw.length >= MIN && pw === pw2 && !cargando;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeEnviar) return;
    setError(""); setCargando(true);

    const { error: err } = await supabase.auth.updateUser({ password: pw });
    if (err) {
      setCargando(false);
      // Supabase rechaza contraseñas filtradas si está activada esa protección.
      if (/pwned|leaked|compromised/i.test(err.message)) {
        setError("Esa contraseña aparece en filtraciones conocidas. Elige otra.");
      } else if (/should be at least|weak|short/i.test(err.message)) {
        setError(`La contraseña debe tener al menos ${MIN} caracteres.`);
      } else {
        setError(friendlyError(err, "No fue posible actualizar la contraseña."));
      }
      return;
    }

    await supabase.auth.signOut();
    setCargando(false);
    setListo(true);
    setTimeout(() => router.replace("/login"), 2500);
  }

  if (enlaceValido === false) {
    return (
      <div className="admin-login-wrap">
        <div className="login-card">
          <div className="brand">
            <div className="brand-text"><span className="l1">PREOPERATIONAL </span><span className="l2">SYSTEM</span></div>
          </div>
          <h1 className="login-title">Enlace no válido</h1>
          <p className="login-sub">
            Este enlace ya caducó o se abrió en un navegador distinto al que lo solicitó.
            Pide uno nuevo: sólo toma un momento.
          </p>
          <Link href="/recuperar" className="btn btn-primary btn-block">Pedir un enlace nuevo</Link>
          <Link href="/login" className="btn btn-ghost btn-block" style={{ marginTop: 10 }}>
            Volver al inicio de sesión
          </Link>
        </div>
      </div>
    );
  }

  if (listo) {
    return (
      <div className="admin-login-wrap">
        <div className="login-card">
          <div className="brand">
            <div className="brand-text"><span className="l1">PREOPERATIONAL </span><span className="l2">SYSTEM</span></div>
          </div>
          <h1 className="login-title">Contraseña actualizada</h1>
          <p className="login-sub">Ya puedes entrar con tu contraseña nueva. Te llevamos al inicio de sesión…</p>
          <Link href="/login" className="btn btn-primary btn-block">Ir ahora</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand">
          <div className="brand-text"><span className="l1">PREOPERATIONAL </span><span className="l2">SYSTEM</span></div>
        </div>
        <h1 className="login-title">Nueva contraseña</h1>
        <p className="login-sub">Debe tener al menos {MIN} caracteres.</p>

        <div className="form-group">
          <label htmlFor="pw">Contraseña nueva</label>
          <div className="pw-field">
            <input id="pw" type={ver ? "text" : "password"} className="manage-input" style={{ width: "100%" }}
              autoComplete="new-password" value={pw} required
              onChange={(e) => setPw(e.target.value)} />
            <button type="button" className="pw-toggle" onClick={() => setVer((s) => !s)}
              aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}>
              {ver ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {corta && <div className="cell-sub" style={{ color: "var(--orange)", marginTop: 6 }}>
            Te faltan {MIN - pw.length} caracteres.
          </div>}
        </div>

        <div className="form-group">
          <label htmlFor="pw2">Repite la contraseña</label>
          <input id="pw2" type={ver ? "text" : "password"} className="manage-input" style={{ width: "100%" }}
            autoComplete="new-password" value={pw2} required
            onChange={(e) => setPw2(e.target.value)} />
          {noCoincide && <div className="cell-sub" style={{ color: "var(--red)", marginTop: 6 }}>
            Las contraseñas no coinciden.
          </div>}
        </div>

        {error && <div className="err-box" style={{ marginBottom: 12 }}>{error}</div>}

        <button className="btn btn-primary btn-block" disabled={!puedeEnviar} type="submit">
          {cargando ? "Guardando…" : "Guardar contraseña"}
        </button>
      </form>
    </div>
  );
}
