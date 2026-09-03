"use client";

// Marco de la consola: barra superior, navegación y salida.
//
// Barra SUPERIOR y no lateral, a diferencia del panel de cliente. La forma
// distinta es la señal más rápida de "estás en otro sitio", más rápida que
// leer un título.

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/consola", label: "Resumen" },
  { href: "/consola/empresas", label: "Empresas" },
  { href: "/consola/clave", label: "Clave" },
];

export default function ConsolaShell({
  children, quien,
}: { children: React.ReactNode; quien: string }) {
  const pathname = usePathname();
  return (
    <>
      <header className="c-top">
        <span className="c-marca">
          <span className="c-cuadro" aria-hidden="true" />
          Plataforma <em>/ consola</em>
        </span>
        <nav className="c-nav">
          {NAV.map((n) => {
            const activo = n.href === "/consola" ? pathname === "/consola" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={activo ? "activo" : undefined}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="c-top-fin">
          <span className="c-quien">{quien}</span>
          {/* Salir de la consola NO cierra la sesión de correo: son dos
              cerraduras distintas y se cierran por separado. */}
          <form action="/api/consola/cerrar" method="post">
            <button type="submit" className="c-salir">Salir</button>
          </form>
        </div>
      </header>
      <main className="c-cuerpo">{children}</main>
    </>
  );
}
