"use client";

// Estructura del panel: barra lateral, cabecera y navegación responsive.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { initials } from "@/lib/format";
import Logo from "@/components/brand/Logo";
import OrgSwitcher from "@/components/admin/OrgSwitcher";
import type { Role } from "@/lib/types";
import BuscadorGlobal from "./BuscadorGlobal";

const ICONS: Record<string, string> = {
  dashboard: '<rect x="3" y="3" width="8" height="8" rx="1.6"/><rect x="13" y="3" width="8" height="5" rx="1.6"/><rect x="13" y="10" width="8" height="11" rx="1.6"/><rect x="3" y="13" width="8" height="8" rx="1.6"/>',
  inspecciones: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3" stroke-linecap="round"/>',
  vehiculos: '<rect x="2" y="7" width="13" height="10" rx="1.5"/><path d="M15 10h3.3a1 1 0 0 1 .85.47L21 14v3h-2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
  conductores: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4" stroke-linecap="round"/>',
  novedades: '<path d="M12 9v4M12 17h.01M10.3 3.9 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" stroke-linecap="round" stroke-linejoin="round"/>',
  avisos: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1" stroke-linecap="round"/>',
  rondas: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v4h-4" stroke-linecap="round" stroke-linejoin="round"/>',
  reportes: '<path d="M4 20V10M10 20V4M16 20v-7M4 20h16" stroke-linecap="round" stroke-linejoin="round"/>',
  usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke-linecap="round"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round"/>',
  configuracion: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.9 7.9 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a8 8 0 0 0-1.7-1L14.9 3H9.1l-.4 2.9a8 8 0 0 0-1.7 1l-2.5-1-2 3.4L4.6 11a7.9 7.9 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a8 8 0 0 0 1.7 1l.4 2.9h5.8l.4-2.9a8 8 0 0 0 1.7-1l2.5 1 2-3.4z" stroke-linejoin="round"/>',
};

const NAV_BASE = [
  { href: "/admin", key: "dashboard", label: "Dashboard" },
  { href: "/admin/inspecciones", key: "inspecciones", label: "Inspecciones" },
  { href: "/admin/vehiculos", key: "vehiculos", label: "Vehículos" },
  { href: "/admin/conductores", key: "conductores", label: "Conductores" },
  { href: "/admin/novedades", key: "novedades", label: "Novedades" },
  { href: "/admin/avisos", key: "avisos", label: "Avisos" },
  { href: "/admin/rondas", key: "rondas", label: "Rondas" },
  { href: "/admin/qr", key: "qr", label: "Acceso QR" },
  { href: "/admin/reportes", key: "reportes", label: "Reportes" },
  { href: "/admin/usuarios", key: "usuarios", label: "Usuarios" },
  { href: "/admin/configuracion", key: "configuracion", label: "Configuración" },
  // "Auditoría" se retiró del menú por decisión de producto (los audit_logs siguen activos en backend).
];

// La consola de plataforma NO vive aquí. Está en /consola, con su propia clave
// y su propio diseño. Mezclarla con el menú del cliente confundía dos oficios
// distintos y hacía que una sola contraseña abriera la operación de una empresa
// y el panorama de todas.

const TITLES: Record<string, [string, string]> = {
  "/admin": ["Dashboard", "Panorama operativo de la flota"],
  "/admin/inspecciones": ["Inspecciones", "Historial completo de inspecciones preoperacionales"],
  "/admin/vehiculos": ["Vehículos", "Estado y ficha de cada unidad de la flota"],
  "/admin/conductores": ["Conductores", "Personal habilitado para realizar inspecciones"],
  "/admin/novedades": ["Novedades", "Hallazgos, evidencias y su estado de atención"],
  "/admin/avisos": ["Avisos", "Mensajes de WhatsApp hacia los conductores"],
  "/admin/rondas": ["Rondas", "Control operativo de rondas de inspección"],
  "/admin/qr": ["Acceso QR", "Cartel para que los conductores entren al kiosco"],
  "/admin/reportes": ["Reportes", "Análisis, evidencia y exportación de la operación"],
  "/admin/usuarios": ["Usuarios", "Quién entra al sistema y con qué permisos"],
  "/admin/configuracion": ["Configuración", "Checklist, operación y sistema"],
};

function navIcon(key: string) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      dangerouslySetInnerHTML={{ __html: ICONS[key] ?? "" }} />
  );
}

export default function AdminShell({
  children, name, role, orgName = null,
}: {
  children: React.ReactNode;
  name: string;
  role: Role;
  orgName?: string | null;
}) {
  const NAV = NAV_BASE;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [title, sub] =
    TITLES[pathname] ??
    (Object.entries(TITLES).find(([k]) => k !== "/admin" && pathname.startsWith(k))?.[1] ?? ["Panel", ""]);
  const today = new Date().toLocaleDateString("es-CO", {
    timeZone: "America/Bogota", weekday: "short", day: "2-digit", month: "short",
  });

  return (
    <div className="admin-shell admin-mode">
      <div className={"sidebar-scrim" + (open ? " show" : "")} onClick={() => setOpen(false)} />
      <aside className={"admin-sidebar" + (open ? " open" : "")}>
        <div className="sb-head">
          <div className="brand">
            <span className="brand-mark"><Logo size={54} tone="light" /></span>
            <div className="brand-text"><span className="l1">PREOPERATIONAL </span><span className="l2">SYSTEM</span></div>
          </div>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,.5)", marginTop: 4, letterSpacing: ".6px" }}>
            GESTIÓN DE FLOTAS
          </div>
          {/* Sólo aparece si el usuario pertenece a más de una empresa. */}
          <OrgSwitcher actual={orgName} />
        </div>
        <nav className="sb-nav">
          {NAV.map((n) => {
            const active = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={"sb-link" + (active ? " active" : "")} onClick={() => setOpen(false)}>
                {navIcon(n.key)}{n.label}
              </Link>
            );
          })}
        </nav>
        <svg className="sb-watermark" width="180" height="90" viewBox="0 0 180 90" fill="none" aria-hidden="true">
          <path d="M0 66 Q40 52 80 64 T170 62" stroke="#fff" strokeWidth="1.6" opacity=".5" />
          <path d="M28 64 L28 46 L96 46 L108 56 L108 64 Z" fill="#fff" opacity=".5" />
          <rect x="42" y="40" width="7" height="6" fill="#fff" opacity=".5" />
          <rect x="54" y="40" width="7" height="6" fill="#fff" opacity=".5" />
          <rect x="66" y="40" width="7" height="6" fill="#fff" opacity=".5" />
        </svg>
        <div className="sb-foot">
          <div className="sb-avatar">{initials(name || "Usuario")}</div>
          <div><div className="nm">{name || "Usuario"}</div><div className="rl" style={{ textTransform: "capitalize" }}>{role}</div></div>
          <form action="/auth/signout" method="post" style={{ marginLeft: "auto" }}>
            <button type="submit" className="sb-exit" title="Cerrar sesión">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
        </div>
      </aside>

      <div className="admin-main">
        <div className="admin-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <button className="hamburger" onClick={() => setOpen(true)} aria-label="Menú">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <div style={{ minWidth: 0 }}>
              <div className="at-title">{title}</div>
              <div className="at-sub">{sub}</div>
            </div>
          </div>
          <div className="at-actions">
            <BuscadorGlobal />
            <div className="date-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              <span style={{ textTransform: "capitalize" }}>{today}</span>
            </div>
          </div>
        </div>
        <div className="admin-body">{children}</div>
      </div>
    </div>
  );
}
