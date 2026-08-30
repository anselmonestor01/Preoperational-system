"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { initials } from "@/lib/format";
import type { Role } from "@/lib/types";

const NAV: { href: string; label: string; icon: JSX.Element; roles?: Role[] }[] = [
  { href: "/admin", label: "Dashboard", icon: ic("M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z") },
  { href: "/admin/inspecciones", label: "Inspecciones", icon: ic("M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M14 3v4h4") },
  { href: "/admin/vehiculos", label: "Vehículos", icon: ic("M2 7h13v10H2z M15 10h3.3l1.7 3v4h-2") },
  { href: "/admin/conductores", label: "Conductores", icon: ic("M12 8a3 3 0 100-6 3 3 0 000 6z M5 20c1-3.6 4-5.4 7-5.4s6 1.8 7 5.4") },
  { href: "/admin/novedades", label: "Novedades", icon: ic("M12 9v4M12 17h.01M10.3 3.9L2.5 17a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z") },
  { href: "/admin/rondas", label: "Rondas", icon: ic("M21 12a9 9 0 11-3-6.7M21 4v4h-4") },
  { href: "/admin/reportes", label: "Reportes", icon: ic("M4 20V10M10 20V4M16 20v-7M4 20h16") },
  { href: "/admin/configuracion", label: "Configuración", icon: ic("M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 13a7.9 7.9 0 000-2l2.1-1.6-2-3.4-2.5 1a8 8 0 00-1.7-1L14.9 3H9.1l-.4 2.9a8 8 0 00-1.7 1l-2.5-1-2 3.4L2.6 11a7.9 7.9 0 000 2l-2.1 1.6") },
  { href: "/admin/auditoria", label: "Auditoría", icon: ic("M9 11l3 3L22 4M21 12v7a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1h11"), roles: ["admin", "auditor", "superadmin"] },
];

const TITLES: Record<string, [string, string]> = {
  "/admin": ["Dashboard", "Panorama operativo en tiempo real"],
  "/admin/inspecciones": ["Inspecciones", "Historial completo de inspecciones preoperacionales"],
  "/admin/vehiculos": ["Vehículos", "Estado y ficha de cada unidad de la flota"],
  "/admin/conductores": ["Conductores", "Personal habilitado para realizar inspecciones"],
  "/admin/novedades": ["Novedades", "Hallazgos y su estado de atención"],
  "/admin/rondas": ["Rondas", "Control de rondas de inspección"],
  "/admin/reportes": ["Reportes", "Análisis y exportación de la operación"],
  "/admin/configuracion": ["Configuración", "Checklist, versiones y parámetros"],
  "/admin/auditoria": ["Auditoría", "Registro inmutable de acciones críticas"],
};

function ic(d: string) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AdminShell({
  children, name, role,
}: { children: React.ReactNode; name: string; role: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const nav = NAV.filter((n) => !n.roles || n.roles.includes(role));
  const [title, sub] =
    TITLES[pathname] ??
    (Object.entries(TITLES).find(([k]) => k !== "/admin" && pathname.startsWith(k))?.[1] ?? ["Panel", ""]);

  return (
    <div className="admin-shell">
      <div className={"sidebar-scrim" + (open ? " show" : "")} onClick={() => setOpen(false)} />
      <aside className={"admin-sidebar" + (open ? " open" : "")}>
        <div className="sb-head">
          <span className="l1">MUNDO</span><span className="l2">MARÍTIMO</span>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,.5)", marginTop: 3, letterSpacing: ".5px" }}>
            SISTEMA PREOPERACIONAL
          </div>
        </div>
        <nav className="sb-nav">
          {nav.map((n) => {
            const active = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={"sb-link" + (active ? " active" : "")} onClick={() => setOpen(false)}>
                {n.icon}{n.label}
              </Link>
            );
          })}
        </nav>
        <div className="sb-foot">
          <div className="sb-avatar">{initials(name || "MM")}</div>
          <div><div className="nm">{name || "Usuario"}</div><div className="rl" style={{ textTransform: "capitalize" }}>{role}</div></div>
          <form action="/auth/signout" method="post" style={{ marginLeft: "auto" }}>
            <button type="submit" className="sb-exit" title="Cerrar sesión">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
        </div>
      </aside>

      <div className="admin-main">
        <div className="admin-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="hamburger" onClick={() => setOpen(true)} aria-label="Menú">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <div><div className="at-title">{title}</div><div className="at-sub">{sub}</div></div>
          </div>
        </div>
        <div className="admin-body">{children}</div>
      </div>
    </div>
  );
}
