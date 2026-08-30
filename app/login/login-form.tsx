"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";

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
          <div className="brand-text"><span className="l1">PRE</span><span className="l2">OPERACIONAL</span></div>
        </div>
        <h1 className="login-title">Iniciar sesión</h1>
        <p className="login-sub">Sistema Preoperacional — acceso corporativo.</p>

        <div className="form-group">
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" type="email" className="manage-input" style={{ width: "100%" }}
            autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="password">Contraseña</label>
          <input id="password" type="password" className="manage-input" style={{ width: "100%" }}
            autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>

        {error && <div className="err-box" style={{ marginBottom: 12 }}>{error}</div>}

        <button className="btn btn-primary btn-block" disabled={loading} type="submit">
          {loading ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
