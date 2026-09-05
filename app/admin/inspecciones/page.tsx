// Historial de inspecciones, en dos lecturas.
//
// EL PROBLEMA QUE RESUELVE
// A escala real esta pantalla era una tabla plana interminable. Buscar una
// placa devolvía veinte filas de conductores distintos sin nada que las
// agrupara, y la columna de estado decía «cerrada» tanto cuando el conductor
// volvió sin novedades como cuando volvió con una falla que sigue viva. Dos
// historias muy distintas bajo la misma palabra.
//
// La solución tiene tres partes:
//   · POR RONDA — la unidad de lectura pasa a ser el turno, que es como piensa
//     un jefe de flota. Cada ronda se pliega y trae su resumen en la cabecera.
//   · MOTIVO EXPLÍCITO — cada inspección dice qué pasó y por qué, con la frase
//     redactada en `lib/motivos.ts` para que el tablero y los reportes cuenten
//     exactamente lo mismo.
//   · FILTRO POR RONDA — además de placa, conductor y estado.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fmtKm } from "@/lib/format";
import { motivoDe, etiquetaResultado } from "@/lib/motivos";
import InspectionActions from "./inspection-actions";

export const dynamic = "force-dynamic";

const PAGE = 25;          // filas por página en la vista de lista
const RONDAS_PAGE = 8;    // rondas por página en la vista agrupada

const CAMPOS =
  "id,vehicle_id,vehicle_plate,driver_name,result,authorized,status,operation_status,released," +
  "auth_reasons,void_reason,km_inicial,km_final,recorrido,fuel_in,fuel_out,submitted_at," +
  "checklist_version_number,bad_count,warn_count,device_id,device_label,round_id";

type Busqueda = {
  status?: string; q?: string; page?: string; vista?: string; ronda?: string;
};

/** Cuántas novedades abrió cada inspección y cuántas siguen vivas. Sin esto,
 *  «cerrada» no puede distinguir entre resuelta y todavía retenida. */
async function contarNovedades(supabase: ReturnType<typeof createClient>, ids: string[]) {
  const conteo: Record<string, { abiertas: number; totales: number }> = {};
  if (!ids.length) return conteo;
  const { data } = await supabase.from("issues").select("inspection_id,status").in("inspection_id", ids);
  (data ?? []).forEach((i: any) => {
    if (!i.inspection_id) return;
    const c = (conteo[i.inspection_id] ??= { abiertas: 0, totales: 0 });
    c.totales++; if (i.status !== "resolved") c.abiertas++;
  });
  return conteo;
}

export default async function InspeccionesPage({ searchParams }: { searchParams: Busqueda }) {
  const supabase = createClient();
  const vista = searchParams.vista === "lista" ? "lista" : "rondas";
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const status = searchParams.status ?? "all";
  const ronda = searchParams.ronda ?? "all";
  const q = (searchParams.q ?? "").trim();

  const { data: rondas } = await supabase.from("rounds")
    .select("id,label,round_number,responsible,status,started_at,closed_at")
    .order("round_number", { ascending: false }).limit(200);

  /** Filtros comunes a las dos vistas. */
  const aplicarFiltros = (query: any) => {
    if (status !== "all") query = query.eq("status", status);
    if (ronda !== "all") query = query.eq("round_id", ronda);
    // Una sola caja para placa y conductor: quien busca no siempre sabe cuál
    // de los dos recuerda.
    if (q) query = query.or(`vehicle_plate.ilike.%${q}%,driver_name.ilike.%${q}%`);
    return query.neq("status", "in_progress");
  };

  const enlace = (extra: Partial<Busqueda>) => {
    const p = new URLSearchParams();
    const v = { vista, status, ronda, q, ...extra } as Record<string, string>;
    if (v.vista !== "rondas") p.set("vista", v.vista);
    if (v.status !== "all") p.set("status", v.status);
    if (v.ronda !== "all") p.set("ronda", v.ronda);
    if (v.q) p.set("q", v.q);
    if (extra.page && extra.page !== "1") p.set("page", extra.page);
    const s = p.toString();
    return "/admin/inspecciones" + (s ? `?${s}` : "");
  };

  const chip = (val: string, label: string) => (
    <Link href={enlace({ status: val, page: "1" })}
      className={"btn btn-sm " + (status === val ? "btn-primary" : "btn-ghost")}>{label}</Link>
  );

  // ---------------------------------------------------------------- datos --
  let filas: any[] = [];
  let totalFilas = 0;
  let rondasVisibles: any[] = [];
  let totalRondas = 0;

  if (vista === "lista") {
    let query = aplicarFiltros(supabase.from("inspections").select(CAMPOS, { count: "exact" }))
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .range((page - 1) * PAGE, page * PAGE - 1);
    const { data, count } = await query;
    filas = data ?? []; totalFilas = count ?? 0;
  } else {
    // Se pagina por RONDA, no por inspección: así un turno nunca queda partido
    // entre dos páginas, que es justo lo que hacía ilegible la tabla plana.
    const todas = (rondas ?? []).filter((r) => ronda === "all" || r.id === ronda);
    totalRondas = todas.length;
    rondasVisibles = todas.slice((page - 1) * RONDAS_PAGE, page * RONDAS_PAGE);
    if (rondasVisibles.length) {
      let query = aplicarFiltros(supabase.from("inspections").select(CAMPOS))
        .in("round_id", rondasVisibles.map((r) => r.id))
        .order("submitted_at", { ascending: false, nullsFirst: false });
      const { data } = await query;
      filas = data ?? [];
      totalFilas = filas.length;
    }
  }

  const conteo = await contarNovedades(supabase, filas.map((r) => r.id));
  const totalPages = Math.max(1, Math.ceil(
    (vista === "lista" ? totalFilas / PAGE : totalRondas / RONDAS_PAGE)));

  const porRonda: Record<string, any[]> = {};
  filas.forEach((r) => { (porRonda[r.round_id ?? "sin"] ??= []).push(r); });

  // ---------------------------------------------------------------- vista --
  const Tabla = ({ rs }: { rs: any[] }) => (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead><tr>
          <th>Vehículo</th><th>Conductor</th><th>Fecha / hora</th>
          <th>Km</th><th>Checklist</th><th>Desenlace</th><th></th>
        </tr></thead>
        <tbody>
          {rs.map((r) => {
            const c = conteo[r.id] ?? { abiertas: 0, totales: 0 };
            const m = motivoDe({ ...r, novedades_abiertas: c.abiertas, novedades_total: c.totales });
            const res = etiquetaResultado(r.result);
            return (
              <tr key={r.id}>
                <td className="cell-veh">
                  {r.vehicle_plate}
                  <div className="cell-sub">
                    {r.device_label ?? (r.device_id ? "Dispositivo" : "sin equipo")}
                  </div>
                </td>
                <td>{r.driver_name}</td>
                <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.submitted_at)}</td>
                <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>
                  {fmtKm(r.km_inicial)}{r.km_final != null && <> → {fmtKm(r.km_final)}</>}
                  {r.recorrido != null && <div className="cell-sub">{fmtKm(r.recorrido)} recorridos</div>}
                </td>
                <td>
                  <span className={"badge " + res.tono}>{res.texto}</span>
                  {(r.bad_count || r.warn_count) ? (
                    <div className="cell-sub">{r.bad_count ?? 0} malo · {r.warn_count ?? 0} regular</div>
                  ) : null}
                </td>
                <td style={{ minWidth: 210 }}>
                  <span className={"badge " + m.tono}>{m.titulo}</span>
                  <div className="cell-sub">{m.detalle}</div>
                </td>
                <td><InspectionActions id={r.id} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">Historial de inspecciones</div>
          <div className="panel-sub">
            {vista === "rondas"
              ? `${totalRondas} ronda(s) · ${totalFilas} inspección(es) en las mostradas`
              : `${totalFilas} inspección(es) con estos filtros`}
          </div>
        </div>
      </div>

      <div className="pestanas">
        <Link href={enlace({ vista: "rondas", page: "1" })}
          className={"pestana " + (vista === "rondas" ? "activa" : "")}>Por ronda</Link>
        <Link href={enlace({ vista: "lista", page: "1" })}
          className={"pestana " + (vista === "lista" ? "activa" : "")}>Lista completa</Link>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {chip("all", "Todas")}{chip("authorized", "Autorizadas")}{chip("rejected", "No autorizadas")}
        {chip("closed", "Cerradas")}{chip("voided", "Anuladas")}
        <form style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {vista !== "rondas" && <input type="hidden" name="vista" value={vista} />}
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <select className="select manage-input" name="ronda" defaultValue={ronda} style={{ maxWidth: 200 }}>
            <option value="all">Todas las rondas</option>
            {(rondas ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}{r.status === "open" ? " (abierta)" : ""}
              </option>
            ))}
          </select>
          <input className="manage-input" name="q" defaultValue={q}
            placeholder="Placa o conductor…" style={{ maxWidth: 180 }} />
          <button className="btn btn-ghost btn-sm">Filtrar</button>
        </form>
      </div>

      {vista === "rondas" ? (
        rondasVisibles.length ? rondasVisibles.map((r) => {
          const rs = porRonda[r.id] ?? [];
          const aut = rs.filter((x) => x.authorized === true).length;
          const rec = rs.filter((x) => x.authorized === false).length;
          const ruta = rs.filter((x) => x.operation_status === "open").length;
          return (
            <details key={r.id} className="grupo-ronda" open={r.status === "open"}>
              <summary>
                <span className="grupo-flecha">▶</span>
                <span>
                  <span className="grupo-titulo">{r.label}</span>
                  {r.status === "open" && <span className="badge info" style={{ marginLeft: 8 }}>Abierta</span>}
                  <div className="grupo-meta">
                    Ronda #{r.round_number} · {fmtDateTime(r.started_at)}
                    {r.responsible ? ` · ${r.responsible}` : ""}
                  </div>
                </span>
                <span className="grupo-cifras">
                  <span className="badge neutral">{rs.length} inspección(es)</span>
                  {aut > 0 && <span className="badge ok">{aut} autorizadas</span>}
                  {rec > 0 && <span className="badge bad">{rec} no autorizadas</span>}
                  {ruta > 0 && <span className="badge warn">{ruta} en ruta</span>}
                </span>
              </summary>
              <div className="grupo-cuerpo">
                {rs.length ? <Tabla rs={rs} />
                  : <div className="empty-state" style={{ padding: "22px 10px" }}>
                      Esta ronda no tiene inspecciones que coincidan con los filtros.
                    </div>}
              </div>
            </details>
          );
        }) : <div className="stub"><h3>Sin rondas</h3><p>No hay rondas que coincidan con estos filtros.</p></div>
      ) : (
        filas.length ? <Tabla rs={filas} />
          : <div className="stub"><h3>Historial de inspecciones</h3><p>No hay inspecciones con estos filtros.</p></div>
      )}

      <div className="paginacion">
        <div className="cell-sub">Página {page} de {totalPages}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {page > 1 && <Link className="btn btn-ghost btn-sm" href={enlace({ page: String(page - 1) })}>← Anterior</Link>}
          {page < totalPages && <Link className="btn btn-ghost btn-sm" href={enlace({ page: String(page + 1) })}>Siguiente →</Link>}
        </div>
      </div>
    </div>
  );
}
