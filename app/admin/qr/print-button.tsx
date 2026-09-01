"use client";

// Imprimir es una acción del navegador, así que necesita ejecutarse en el
// cliente. Se aísla en su propio componente para que la página del cartel siga
// siendo un componente de servidor (se renderiza el QR sin enviar la librería
// al navegador).

export default function PrintButton() {
  return (
    <button className="btn btn-primary" onClick={() => window.print()}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="6" y="14" width="12" height="7" rx="1" />
      </svg>
      Imprimir cartel
    </button>
  );
}
