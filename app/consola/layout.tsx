// Consola de plataforma — capa exterior.
//
// Aquí sólo se comprueba lo primero de las dos cerraduras: que quien llama sea
// superadministrador. La segunda (la clave de consola) la exige cada pantalla
// con `requireConsola()`, porque la pantalla de acceso vive bajo este mismo
// layout y obviamente no puede exigirla.
//
// A quien no es superadministrador se le responde 404 y no 403: para el
// administrador de una empresa cliente, esta dirección sencillamente no existe.
import type { Metadata } from "next";
import { requireSuperadmin } from "@/lib/consola";
import "./consola.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Consola de plataforma",
  // La trastienda no se indexa.
  robots: { index: false, follow: false },
};

export default async function ConsolaLayout({ children }: { children: React.ReactNode }) {
  await requireSuperadmin();
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <div className="consola-mode">{children}</div>
    </>
  );
}
