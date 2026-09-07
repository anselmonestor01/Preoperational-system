// Ruta inexistente. Sin esto, Next sirve su página por defecto —en inglés y sin
// la identidad del producto— que es justo el tipo de pantalla que delata que
// algo quedó a medias.
import Link from "next/link";

export default function NoEncontrado() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#F5F8FC" }}>
      <div className="panel estado-grave" style={{ maxWidth: 460 }}>
        <div className="estado-icono" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
        </div>
        <h2 className="estado-titulo">Esta página no existe</h2>
        <p className="estado-texto">La dirección no corresponde a ninguna pantalla del sistema.</p>
        <div className="estado-acciones">
          <Link className="btn btn-primary btn-sm" href="/admin">Ir al panel</Link>
          <Link className="btn btn-ghost btn-sm" href="/kiosco">Ir al kiosco</Link>
        </div>
      </div>
    </div>
  );
}
