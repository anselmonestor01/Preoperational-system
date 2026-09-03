"use client";

// Formulario de acceso. Autentica contra Supabase Auth y enruta por rol
// (operador/conductor → kiosco, resto → administración). Los errores de Auth se
// traducen a mensajes accionables en vez de un genérico.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/brand/Logo";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

export default function LoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { data: signData, error: signErr } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signErr || !signData.user) {
      if (signErr) console.error("[login] signInWithPassword:", signErr.message, signErr);
      const msg = signErr?.message ?? "";
      if (msg.toLowerCase().includes("invalid login credentials")) {
        setError("Correo o contraseña incorrectos.");
      } else if (msg.toLowerCase().includes("email not confirmed")) {
        setError("Este correo aún no ha sido confirmado.");
      } else if (msg.toLowerCase().includes("too many requests") || msg.toLowerCase().includes("rate limit")) {
        setError("Demasiados intentos. Espera un minuto e inténtalo de nuevo.");
      } else {
        setError(signErr ? `No se pudo iniciar sesión: ${msg}` : "Correo o contraseña incorrectos.");
      }
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("role,active")
      .eq("id", signData.user.id)
      .maybeSingle();
    if (!data || !data.active) {
      setError("Su usuario no está habilitado. Contacte al administrador.");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }
    const home = data.role === "operator" || data.role === "driver" ? "/kiosco" : "/admin";
    router.replace(home);
    router.refresh();
  }

  return (
    <div className="admin-login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand">
          <span className="brand-mark"><Logo size={60} /></span>
          <div className="brand-text"><span className="l1">PREOPERATIONAL </span><span className="l2">SYSTEM</span></div>
        </div>
        <h1 className="login-title">Iniciar sesión</h1>
        <p className="login-sub">Inspección preoperacional de flotas — acceso corporativo.</p>

        <div className="form-group">
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" type="email" className="manage-input" style={{ width: "100%" }}
            autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="password">Contraseña</label>
          <div className="pw-field">
            <input id="password" type={showPw ? "text" : "password"} className="manage-input" style={{ width: "100%" }}
              autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"}>
              {showPw ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </div>

        {error && <div className="err-box" style={{ marginBottom: 12 }}>{error}</div>}

        <button className="btn btn-primary btn-block" disabled={loading} type="submit">
          {loading ? "Ingresando…" : "Ingresar"}
        </button>
        <Link href="/recuperar" className="login-link">¿Olvidaste tu contraseña?</Link>
      </form>
    </div>
  );
}
