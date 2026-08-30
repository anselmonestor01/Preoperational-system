"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { data: signData, error: signErr } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signErr || !signData.user) {
      setError("Correo o contraseña incorrectos.");
      setLoading(false);
      return;
    }
    // Determinar destino por rol — SIEMPRE acotado al propio usuario.
    // RLS permite ver a todos los perfiles de la organización; sin filtrar por
    // id la consulta devolvería varias filas y maybeSingle() fallaría (lo que
    // se interpretaba erróneamente como "usuario no habilitado").
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
    const home =
      data.role === "operator" || data.role === "driver" ? "/kiosco" : "/admin";
    router.replace(home);
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <span className="l1">MUNDO</span>
          <span className="l2">MARÍTIMO</span>
        </div>
        <h2 style={{ margin: "20px 0 2px", fontSize: 22 }}>Iniciar sesión</h2>
        <p style={{ color: "var(--muted)", fontSize: 13.5, margin: 0 }}>
          Sistema Preoperacional — acceso corporativo.
        </p>

        <div className="form-group">
          <label htmlFor="email">Correo electrónico</label>
          <input
            id="email"
            type="email"
            className="input"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <div className="error-box" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 18 }}
          disabled={loading}
          type="submit"
        >
          {loading ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
