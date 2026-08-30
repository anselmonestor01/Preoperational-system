"use client";

type Row = {
  submitted_at: string | null; vehicle_plate: string | null; driver_name: string | null;
  result: string | null; authorized: boolean | null; km_inicial: number | null;
  km_final: number | null; recorrido: number | null; checklist_version_number: number | null;
};

export default function ExportButton({ rows }: { rows: Row[] }) {
  function exportCsv() {
    const headers = ["Fecha", "Vehiculo", "Conductor", "Resultado", "Autorizado", "KmInicial", "KmFinal", "Recorrido", "VersionChecklist"];
    const lines = rows.map((r) => [
      r.submitted_at ?? "", r.vehicle_plate ?? "", r.driver_name ?? "", r.result ?? "",
      r.authorized ? "Si" : "No", r.km_inicial ?? "", r.km_final ?? "", r.recorrido ?? "", r.checklist_version_number ?? "",
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    const csv = [headers.join(","), ...lines].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-inspecciones-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!rows.length}>Exportar CSV</button>;
}
