"use client";

// Exportación del reporte filtrado a CSV (con BOM, para abrir bien en Excel).
//
// Exporta LO QUE SE ESTÁ VIENDO: si la pestaña activa es el resumen por
// conductor, baja ese resumen y no la tabla de detalle. Un botón que siempre
// exporta lo mismo obliga a rehacer el agrupado a mano en la hoja de cálculo.

export default function ExportButton({ rows, nombre = "reporte" }: {
  rows: Record<string, unknown>[]; nombre?: string;
}) {
  function exportCsv() {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const esc = (c: unknown) => `"${String(c ?? "").replace(/"/g, '""')}"`;
    const csv = [
      headers.map(esc).join(","),
      ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
    ].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!rows.length}>
      Exportar CSV ({rows.length})
    </button>
  );
}
