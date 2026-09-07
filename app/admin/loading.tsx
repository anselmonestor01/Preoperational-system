// Esqueleto mientras el servidor resuelve. Antes la navegación entre módulos no
// daba señal alguna: en una consulta lenta parecía que el clic no había hecho
// nada y el usuario volvía a pulsar.
export default function CargandoPanel() {
  return (
    <div className="panel" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando el módulo…</span>
      <div className="hueso hueso-titulo" />
      <div className="hueso hueso-sub" />
      <div className="huesos-filas">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="hueso hueso-fila" />)}
      </div>
    </div>
  );
}
