"use client";

// Gestión de usuarios del sistema: cambiar rol, activar y desactivar.
//
// Las reglas las impone la base de datos, no esta pantalla: no puedes cambiar tu
// propio rol ni desactivarte, y la organización no puede quedarse sin ningún
// administrador activo. Aquí sólo se ocultan los botones para que no se intente
// algo que el servidor va a rechazar.
//
// Crear usuarios nuevos NO se hace desde aquí: alta de cuentas requiere permisos
// de administración de Supabase que no deben viajar al navegador. Se explica en
// pantalla cómo hacerlo de forma segura.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { initials } from "@/lib/format";
import { useDialog } from "@/components/ui/dialogs";

export interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  active: boolean;
  created_at: string;
}

/** Roles ofrecidos en la interfaz, en lenguaje de negocio. */
const ROLES: { value: string; label: string; help: string }[] = [
  { value: "admin", label: "Administrador", help: "Control total: flota, usuarios y depuración de historial." },
  { value: "supervisor", label: "Supervisor", help: "Supervisa inspecciones y novedades; no depura el historial." },
  { value: "maintenance", label: "Mantenimiento", help: "Atiende y resuelve las novedades de los vehículos." },
  { value: "auditor", label: "Auditor", help: "Sólo consulta: no puede modificar nada." },
  { value: "operator", label: "Operador de kiosco", help: "Abre el kiosco donde los conductores inspeccionan." },
];

const etiquetaRol = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r;

export default function UsersClient({ rows, myId }: { rows: UserRow[]; myId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const dialog = useDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3200); };

  const admins = rows.filter((u) => u.active && (u.role === "admin" || u.role === "superadmin"));

  async function cambiarRol(u: UserRow) {
    const actual = etiquetaRol(u.role);
    const opciones = ROLES.map((r) => `${r.label}${r.value === u.role ? " (actual)" : ""}`).join("\n");
    const elegido = await dialog.prompt({
      title: `Rol de ${u.full_name || u.email}`,
      message: `Rol actual: ${actual}.\n\nEscribe el nuevo rol:\n${opciones}`,
      label: "Nuevo rol",
      placeholder: "Administrador, Supervisor, Mantenimiento, Auditor u Operador",
      required: true,
      confirmLabel: "Cambiar rol",
    });
    if (elegido === null) return;

    const norm = elegido.trim().toLowerCase();
    const rol = ROLES.find(
      (r) => r.label.toLowerCase() === norm || r.value === norm || r.label.toLowerCase().startsWith(norm),
    );
    if (!rol) return show("No reconocí ese rol. Escríbelo como aparece en la lista.");
    if (rol.value === u.role) return;

    setBusy(u.id);
    const { error } = await supabase.rpc("set_profile_role", { p_profile_id: u.id, p_role: rol.value });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible cambiar el rol."));
    show(`${u.full_name || u.email} ahora es ${rol.label}`);
    router.refresh();
  }

  async function alternarActivo(u: UserRow) {
    const ok = await dialog.confirm({
      title: u.active ? "Desactivar usuario" : "Reactivar usuario",
      message: u.active
        ? `${u.full_name || u.email} no podrá volver a iniciar sesión. Su historial y su rastro en la auditoría se conservan.`
        : `${u.full_name || u.email} podrá volver a iniciar sesión con su contraseña de siempre.`,
      confirmLabel: u.active ? "Desactivar" : "Reactivar",
      tone: u.active ? "danger" : "default",
    });
    if (!ok) return;

    setBusy(u.id);
    const { error } = await supabase.rpc("set_profile_active", { p_profile_id: u.id, p_active: !u.active });
    setBusy(null);
    if (error) return show(friendlyError(error, "No fue posible cambiar el estado."));
    show(u.active ? "Usuario desactivado" : "Usuario reactivado");
    router.refresh();
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Usuarios del sistema</div>
            <div className="panel-sub">
              {rows.length} usuario(s) · {admins.length} administrador(es) activo(s).
              Los conductores se gestionan aparte: ellos se identifican con PIN, no con contraseña.
            </div>
          </div>
        </div>

        <div className="manage-list">
          {rows.map((u) => {
            const soyYo = u.id === myId;
            return (
              <div key={u.id} className="manage-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div className="manage-row-main" style={{ flex: "1 1 240px" }}>
                    <span className="manage-avatar">{initials(u.full_name || u.email || "?")}</span>
                    <span>{u.full_name || "Sin nombre"}</span>
                    {soyYo && <span className="badge info" style={{ marginLeft: 6 }}>Tú</span>}
                    {u.active
                      ? <span className="badge ok" style={{ marginLeft: 6 }}>Activo</span>
                      : <span className="badge bad" style={{ marginLeft: 6 }}>Inactivo</span>}
                    <span className="badge neutral" style={{ marginLeft: 6 }}>{etiquetaRol(u.role)}</span>
                  </div>
                </div>
                <div className="cell-sub">{u.email}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {/* Sobre uno mismo no se ofrecen acciones: la base de datos las
                      rechaza para que nadie se quede fuera de su propio sistema. */}
                  {soyYo ? (
                    <span className="cell-sub" style={{ fontStyle: "italic" }}>
                      No puedes cambiar tu propio rol ni desactivarte.
                    </span>
                  ) : (
                    <>
                      <button className="btn btn-ghost btn-sm" disabled={busy === u.id} onClick={() => cambiarRol(u)}>
                        Cambiar rol
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={busy === u.id} onClick={() => alternarActivo(u)}
                        style={u.active ? { color: "var(--red)", borderColor: "rgba(198,66,60,.25)" } : undefined}>
                        {u.active ? "Desactivar" : "Reactivar"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div className="empty-state">No hay usuarios registrados.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Qué puede hacer cada rol</div>
            <div className="panel-sub">Los permisos los aplica la base de datos, no la interfaz.</div>
          </div>
        </div>
        <div className="manage-list">
          {ROLES.map((r) => (
            <div key={r.value} className="manage-row manage-row-sm">
              <div className="manage-row-main"><strong>{r.label}</strong></div>
              <span className="cell-sub">{r.help}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Crear un usuario nuevo</div>
            <div className="panel-sub">Por seguridad, el alta de cuentas no se hace desde el navegador.</div>
          </div>
        </div>
        <div className="dialog-message" style={{ margin: 0 }}>
          Dar de alta una cuenta exige una credencial de administración de Supabase que
          <b> nunca debe viajar al navegador</b>: si estuviera aquí, cualquiera podría extraerla
          y crear usuarios a voluntad. Para invitar a alguien, entra al panel de Supabase →
          <b> Authentication → Users → Add user</b>, y luego asígnale su rol desde esta pantalla.
          El usuario nuevo puede definir su contraseña con <b>¿Olvidaste tu contraseña?</b> en el inicio de sesión.
        </div>
      </div>

      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
