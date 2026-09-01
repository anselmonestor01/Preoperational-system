// Layout raíz: metadatos del producto, viewport de kiosco y tipografías.
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Preoperational System — Inspección de Flotas",
  description:
    "Sistema empresarial de inspección preoperacional de vehículos: checklist digital, bloqueo automático de salida y trazabilidad completa por flota.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        {/* Las familias tipográficas se cargan por <link> porque el CSS portado
            del prototipo referencia 'Inter' y 'Space Grotesk' por nombre en
            decenas de reglas. La regla de ESLint `no-page-custom-font` apunta a
            `pages/_document.js` (Pages Router) y no aplica aquí; está
            desactivada en .eslintrc.json. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
