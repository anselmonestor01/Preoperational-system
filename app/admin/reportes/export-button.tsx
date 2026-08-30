"use client";

export default function ExportButton({ rows }: { rows: Record<string, unknown>[] }) {
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
    a.download = `reporte-preoperacional-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!rows.length}>Exportar CSV</button>;
}
