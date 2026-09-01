"use client";

// Solicitud de restablecimiento de contraseña.
//
// Detalle de seguridad deliberado: la respuesta es SIEMPRE la misma, exista o no
// el correo. Confirmar "ese correo no está registrado" permitiría a un tercero
// averiguar quién trabaja en la empresa probando direcciones.

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function RecoverForm() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCargando(true);

    const { error: err } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/restablecer` },
    );
    setCargando(false);

    // Un límite de envíos sí se informa: es un problema real que el usuario
    // puede resolver esperando. Cualquier otro caso se responde igual.
    if (err && /rate|limit|too many/i.test(err.message)) {
      setError("Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
      return;
    }
    setEnviado(true);
  }

  if (enviado) {
    return (
      <div className="admin-login-wrap">
        <div className="login-card">
          <div className="brand">
            <div className="brand-text"><span className="l1">PREOPERATIONAL </span><span className="l2">SYSTEM</span></div>
          </div>
          <h1 className="login-title">Revisa tu correo</h1>
          <p className="login-sub">
            Si <b>{email.trim().toLowerCase()}</b> corresponde a una cuenta activa, te enviamos
            un enlace para crear una contraseña nueva. El enlace caduca por seguridad.
          </p>
          <div className="dialog-message" style={{ marginTop: 4 }}>
            ¿No lo ves? Revisa la carpeta de correo no deseado.
          </div>
          <Link href="/login" className="btn btn-ghost btn-block" style={{ marginTop: 8 }}>
            Volver al inicio de sesión
          </Link>
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
        <h1 className="login-title">Recuperar contraseña</h1>
        <p className="login-sub">Te enviaremos un enlace para crear una contraseña nueva.</p>

        <div className="form-group">
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" type="email" className="manage-input" style={{ width: "100%" }}
            autoComplete="username" value={email} required
            onChange={(e) => setEmail(e.target.value)} />
        </div>

        {error && <div className="err-box" style={{ marginBottom: 12 }}>{error}</div>}

        <button className="btn btn-primary btn-block" disabled={cargando} type="submit">
          {cargando ? "Enviando…" : "Enviar enlace"}
        </button>
        <Link href="/login" className="btn btn-ghost btn-block" style={{ marginTop: 10 }}>
          Cancelar
        </Link>
      </form>
    </div>
  );
}
