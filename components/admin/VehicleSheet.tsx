"use client";

// Ficha completa de una unidad, sin salir de donde estabas.
//
// POR QUÉ EXISTE
// Ver que ZZZ-005 está bloqueado no sirve de nada por sí solo: la pregunta
// siguiente es siempre «¿por qué, desde cuándo, quién lo reportó y con qué
// evidencia?». Antes había que abandonar el tablero, ir a Vehículos, buscar la
// placa, abrir Datos del vehículo y de ahí saltar a Novedades. Cinco pasos para
// una pregunta. Ahora se abre aquí.
//
// Se carga bajo demanda, al abrir: con setenta vehículos en pantalla no tiene
// sentido traer el historial de todos por si acaso.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtKm } from "@/lib/format";
import { motivoDe } from "@/lib/motivos";
import { horasDesde, nivelUrgencia, antiguedad, CLASE_URGENCIA } from "@/lib/urgencia";
import EvidenceGallery from "@/components/EvidenceGallery";

type Novedad = {
  id: string; item_name: string; category_key: string | null; severity: string;
  status: string; description: string | null; created_at: string;
  resolution_note: string | null; resolved_at: string | null;
  reportadaPor: string | null; evidencias: string[];
};

type Historial = {
  id: string; submitted_at: string | null; closed_at: string | null;
  driver_name: string | null; status: string; authorized: boolean | null;
  result: string | null; operation_status: string | null; released: boolean | null;
  auth_reasons: unknown; km_inicial: number | null; km_final: number | null;
  warn_count: number | null; bad_count: number | null;
  ronda: string | null;
  abiertas: number; totales: number;
};

export default function VehicleSheet({
  vehicleId, plate, onClose,
}: { vehicleId: string; plate: string; onClose: () => void }) {
  const supabase = createClient();
  const [cargando, setCargando] = useState(true);
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [historial, setHistorial] = useState<Historial[]>([]);
  const [ficha, setFicha] = useState<any>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: v }, { data: iss }, { data: insp }] = await Promise.all([
        supabase.from("vehicle_status_view").select("*").eq("id", vehicleId).maybeSingle(),
        supabase.from("issues")
          .select("id,item_name,category_key,severity,status,description,created_at,resolution_note,resolved_at,inspection_id,inspections(driver_name)")
          .eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(40),
        supabase.from("inspections")
          .select("id,submitted_at,closed_at,driver_name,status,authorized,result,operation_status,released,auth_reasons,km_inicial,km_final,warn_count,bad_count,round_id,rounds(label)")
          .eq("vehicle_id", vehicleId).neq("status", "in_progress")
          .order("submitted_at", { ascending: false }).limit(20),
      ]);
      if (!vivo) return;

      // Las fotos viven en un bucket privado: hay que firmarlas para poder verlas.
      const ids = (iss ?? []).map((i: any) => i.id);
      const porNovedad: Record<string, string[]> = {};
      if (ids.length) {
        const { data: evs } = await supabase.from("issue_evidence")
          .select("issue_id,storage_path").in("issue_id", ids);
        const rutas = (evs ?? []).map((e: any) => e.storage_path);
        if (rutas.length) {
          const { data: firmadas } = await supabase.storage.from("evidence").createSignedUrls(rutas, 3600);
          const mapa: Record<string, string> = {};
          (firmadas ?? []).forEach((s) => { if (s.path && s.signedUrl) mapa[s.path] = s.signedUrl; });
          (evs ?? []).forEach((e: any) => {
            if (mapa[e.storage_path]) (porNovedad[e.issue_id] ??= []).push(mapa[e.storage_path]);
          });
        }
      }

      // Cuántas novedades abrió cada inspección y cuántas siguen vivas: es lo
      // que distingue «cerrada sin novedades» de «cerrada y todavía retenida».
      const porInspeccion: Record<string, { abiertas: number; totales: number }> = {};
      (iss ?? []).forEach((i: any) => {
        if (!i.inspection_id) return;
        const c = (porInspeccion[i.inspection_id] ??= { abiertas: 0, totales: 0 });
        c.totales++; if (i.status !== "resolved") c.abiertas++;
      });

      if (!vivo) return;
      setFicha(v);
      setNovedades((iss ?? []).map((i: any) => ({
        id: i.id, item_name: i.item_name, category_key: i.category_key, severity: i.severity,
        status: i.status, description: i.description, created_at: i.created_at,
        resolution_note: i.resolution_note, resolved_at: i.resolved_at,
        reportadaPor: i.inspections?.driver_name ?? null,
        evidencias: porNovedad[i.id] ?? [],
      })));
      setHistorial((insp ?? []).map((r: any) => ({
        ...r, ronda: r.rounds?.label ?? null,
        abiertas: porInspeccion[r.id]?.abiertas ?? 0,
        totales: porInspeccion[r.id]?.totales ?? 0,
      })));
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, [supabase, vehicleId]);

  const abiertas = novedades.filter((n) => n.status !== "resolved");
  const resueltas = novedades.filter((n) => n.status === "resolved");

  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet wide">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">{plate}</div>
            <div className="cell-sub">
              {ficha?.reference ?? "Unidad"}{ficha?.model ? ` · modelo ${ficha.model}` : ""}
            </div>
          </div>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {cargando ? <div className="spinner" /> : (<>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {ficha?.availability === "available" && <span className="badge ok">Disponible</span>}
            {ficha?.availability === "issues" && <span className="badge warn">Retenida por novedades</span>}
            {ficha?.availability === "admin_blocked" && <span className="badge bad">Bloqueada por administración</span>}
            {ficha?.availability === "inspected" && <span className="badge info">En ruta / ya inspeccionada</span>}
            {ficha?.availability === "out_of_service" && <span className="badge neutral">Fuera de servicio</span>}
            {abiertas.length > 0 && <span className="badge bad">{abiertas.length} novedad(es) sin resolver</span>}
          </div>

          {ficha?.admin_block_reason && (
            <div className="err-box" style={{ marginBottom: 14 }}>
              <b>Motivo del bloqueo:</b> {ficha.admin_block_reason}
            </div>
          )}

          <div className="summary-card">
            <div className="summary-row"><span className="cell-sub">Tarjeta de operación</span><span>{ficha?.operation_card || "—"}</span></div>
            <div className="summary-row"><span className="cell-sub">Seguro vence</span><span>{ficha?.insurance_expires ?? "—"}</span></div>
            <div className="summary-row"><span className="cell-sub">Emisión de gases vence</span><span>{ficha?.emissions_expires ?? "—"}</span></div>
            <div className="summary-row"><span className="cell-sub">Operaciones registradas</span><span>{historial.length}</span></div>
          </div>

          {/* -------------------------------------------------- novedades -- */}
          <div className="panel-title" style={{ marginTop: 18, marginBottom: 8 }}>
            Novedades activas {abiertas.length ? `(${abiertas.length})` : ""}
          </div>
          {abiertas.length ? abiertas.map((n) => {
            const h = horasDesde(n.created_at);
            const nivel = nivelUrgencia(h, n.severity === "bad");
            return (
              <div key={n.id} className={"issue-card urgencia-" + nivel} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <b>{n.item_name}</b>
                  <span style={{ display: "flex", gap: 6 }}>
                    <span className={"badge " + (n.severity === "bad" ? "bad" : "warn")}>
                      {n.severity === "bad" ? "Crítica" : "Leve"}
                    </span>
                    <span className={"badge " + CLASE_URGENCIA[nivel]}>{antiguedad(h)}</span>
                  </span>
                </div>
                <div style={{ fontSize: 13, margin: "4px 0 6px" }}>{n.description || "Sin detalle"}</div>
                <div className="cell-sub" style={{ marginBottom: 8 }}>
                  {n.category_key ? <span style={{ textTransform: "capitalize" }}>{n.category_key}</span> : "—"}
                  {n.reportadaPor ? ` · reportada por ${n.reportadaPor}` : ""}
                  {` · ${fmtDateTime(n.created_at)}`}
                </div>
                <EvidenceGallery urls={n.evidencias} size={72} empty="Sin evidencia fotográfica" />
              </div>
            );
          }) : <div className="empty-state" style={{ padding: "22px 10px" }}>Ninguna novedad sin resolver.</div>}

          {resueltas.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                Novedades ya resueltas ({resueltas.length})
              </summary>
              <div style={{ marginTop: 8 }}>
                {resueltas.map((n) => (
                  <div key={n.id} className="issue-card" style={{ marginBottom: 8, opacity: .85 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <b>{n.item_name}</b><span className="badge ok">Resuelta</span>
                    </div>
                    <div style={{ fontSize: 13, margin: "4px 0" }}>{n.description || "Sin detalle"}</div>
                    {n.resolution_note && (
                      <div className="cell-sub" style={{ color: "var(--green)" }}>
                        Cierre: {n.resolution_note}
                      </div>
                    )}
                    <div className="cell-sub">
                      {n.reportadaPor ? `Reportada por ${n.reportadaPor} · ` : ""}
                      {fmtDateTime(n.created_at)}
                      {n.resolved_at ? ` · resuelta ${fmtDateTime(n.resolved_at)}` : ""}
                    </div>
                    <EvidenceGallery urls={n.evidencias} size={64} empty="" />
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* -------------------------------------------------- historial -- */}
          <div className="panel-title" style={{ marginTop: 18, marginBottom: 8 }}>
            Historial de operaciones
          </div>
          {historial.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead><tr><th>Fecha</th><th>Ronda</th><th>Conductor</th><th>Km</th><th>Desenlace</th></tr></thead>
                <tbody>
                  {historial.map((r) => {
                    const m = motivoDe({ ...r, novedades_abiertas: r.abiertas, novedades_total: r.totales });
                    return (
                      <tr key={r.id}>
                        <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.submitted_at)}</td>
                        <td className="cell-sub">{r.ronda ?? "—"}</td>
                        <td>{r.driver_name}</td>
                        <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>
                          {fmtKm(r.km_inicial)}{r.km_final != null && <> → {fmtKm(r.km_final)}</>}
                        </td>
                        <td>
                          <span className={"badge " + m.tono}>{m.titulo}</span>
                          <div className="cell-sub">{m.detalle}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-state">Esta unidad todavía no tiene operaciones registradas.</div>}
        </>)}
      </div>
    </div>
  );
}
