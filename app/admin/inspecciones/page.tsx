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
import { motivoDe, etiquetaResultado, FRANJA } from "@/lib/motivos";
import InspectionActions from "./inspection-actions";

export const dynamic = "force-dynamic";

const PAGE = 25;          // filas por página en la vista de lista
const RONDAS_PAGE = 8;    // rondas por página en la vista agrupada

const CAMPOS =
  "id,vehicle_id,vehicle_plate,driver_name,result,authorized,status,operation_status,released," +
  "auth_reasons,void_reason,km_inicial,km_final,recorrido,fuel_in,fuel_out,submitted_at," +
  "checklist_version_number,bad_count,warn_count,device_id,device_label,round_id";

type Busqueda = {
  status?: string; q?: string; page?: string; vista?: string; ronda?: string; abierta?: string;
};

/** Cuántas novedades abrió cada inspección y cuántas siguen vivas. Sin esto,
 *  «cerrada» no puede distinguir entre resuelta y todavía retenida. */
async function contarNovedades(supabase: ReturnType<typeof createClient>, ids: string[]) {
  const conteo: Record<string, { abiertas: number; totales: number }> = {};
  if (!ids.length) return conteo;
  // Por lotes: un `in(...)` largo viaja en la URL y a cierta escala la revienta.
  const LOTE = 200;
  const filas: any[] = [];
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data } = await supabase.from("issues")
      .select("inspection_id,status").in("inspection_id", ids.slice(i, i + LOTE));
    if (data) filas.push(...data);
  }
  filas.forEach((i: any) => {
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
  // Divulgación progresiva: al entrar sólo se ven las burbujas de ronda. El
  // detalle —y su consulta— sólo existe para la ronda que el administrador
  // decide abrir. Antes la pantalla traía las inspecciones de ocho rondas de
  // golpe y las volcaba todas en tablas abiertas.
  const abierta = searchParams.abierta ?? "";
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
    const v = { vista, status, ronda, q, abierta, ...extra } as Record<string, string>;
    if (v.vista !== "rondas") p.set("vista", v.vista);
    if (v.status !== "all") p.set("status", v.status);
    if (v.ronda !== "all") p.set("ronda", v.ronda);
    if (v.q) p.set("q", v.q);
    if (v.abierta) p.set("abierta", v.abierta);
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
  /** Cifras por ronda para las burbujas, sin traer la ficha de cada inspección. */
  const resumen: Record<string, { total: number; aut: number; rec: number; ruta: number }> = {};

  if (vista === "lista") {
    let query = aplicarFiltros(supabase.from("inspections").select(CAMPOS, { count: "exact" }))
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .range((page - 1) * PAGE, page * PAGE - 1);
    const { data, count } = await query;
    filas = data ?? []; totalFilas = count ?? 0;
  } else {
    // Se pagina por RONDA, no por inspección: así un turno nunca queda partido
    // entre dos páginas.
    const todas = (rondas ?? []).filter((r) => ronda === "all" || r.id === ronda);
    totalRondas = todas.length;
    rondasVisibles = todas.slice((page - 1) * RONDAS_PAGE, page * RONDAS_PAGE);

    if (rondasVisibles.length) {
      // Para las burbujas basta con cuatro columnas por inspección. Traer la
      // ficha completa de todas las rondas visibles era lo que convertía la
      // entrada al módulo en un volcado.
      const { data: livianas } = await aplicarFiltros(
        supabase.from("inspections").select("round_id,authorized,operation_status,status"))
        .in("round_id", rondasVisibles.map((r) => r.id));
      (livianas ?? []).forEach((i: any) => {
        const c = (resumen[i.round_id ?? "sin"] ??= { total: 0, aut: 0, rec: 0, ruta: 0 });
        c.total++;
        if (i.operation_status === "open") c.ruta++;
        else if (i.authorized === true) c.aut++;
        else if (i.authorized === false) c.rec++;
      });
      totalFilas = (livianas ?? []).length;
    }

    // Y sólo la ronda desplegada carga su detalle.
    if (abierta) {
      const { data } = await aplicarFiltros(supabase.from("inspections").select(CAMPOS))
        .eq("round_id", abierta)
        .order("submitted_at", { ascending: false, nullsFirst: false });
      filas = data ?? [];
    }
  }

  const conteo = await contarNovedades(supabase, filas.map((r) => r.id));
  const totalPages = Math.max(1, Math.ceil(
    (vista === "lista" ? totalFilas / PAGE : totalRondas / RONDAS_PAGE)));

  const porRonda: Record<string, any[]> = {};
  filas.forEach((r) => { (porRonda[r.round_id ?? "sin"] ??= []).push(r); });

  // ---------------------------------------------------------------- vista --
  // Anchos declarados: sin ellos cada tabla se autodimensionaba y las columnas
  // de una ronda no caían en la misma vertical que las de la siguiente, que es
  // lo que hacía ilegible el historial al recorrerlo de arriba abajo.
  const Tabla = ({ rs }: { rs: any[] }) => (
    <div className="tabla-op">
      <table>
        <colgroup>
          <col style={{ width: "13%" }} /><col style={{ width: "16%" }} />
          <col style={{ width: "16%" }} /><col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} /><col /><col style={{ width: "92px" }} />
        </colgroup>
        <thead><tr>
          <th>Vehículo</th><th>Conductor</th><th>Fecha / hora</th>
          <th className="celda-num">Kilometraje</th><th>Checklist</th><th>Desenlace</th><th></th>
        </tr></thead>
        <tbody>
          {rs.map((r) => {
            const c = conteo[r.id] ?? { abiertas: 0, totales: 0 };
            const m = motivoDe({ ...r, novedades_abiertas: c.abiertas, novedades_total: c.totales });
            const res = etiquetaResultado(r.result);
            return (
              <tr key={r.id} className={FRANJA[m.tono]}>
                <td>
                  <span className="placa-celda">{r.vehicle_plate}
                    <span className="origen">{r.device_label ?? (r.device_id ? "Dispositivo" : "sin equipo")}</span>
                  </span>
                </td>
                <td className="celda-corta" title={r.driver_name ?? ""}>{r.driver_name}</td>
                <td className="celda-fecha">{fmtDateTime(r.submitted_at)}</td>
                <td className="celda-num">
                  {fmtKm(r.km_inicial)}
                  {r.recorrido != null && <div className="cell-sub">+{fmtKm(r.recorrido)}</div>}
                </td>
                <td>
                  <span className={"badge " + res.tono}>{res.texto}</span>
                  {(r.bad_count || r.warn_count) ? (
                    <div className="cell-sub">{r.bad_count ?? 0} malo · {r.warn_count ?? 0} reg.</div>
                  ) : null}
                </td>
                <td>
                  <div className="desenlace">
                    <span className={"badge " + m.tono} style={{ alignSelf: "flex-start" }}>{m.titulo}</span>
                    <span className="motivo" title={m.detalle}>{m.detalle}</span>
                  </div>
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
        rondasVisibles.length ? (
          <>
            <div className="burbujas">
              {rondasVisibles.map((r) => {
                const c = resumen[r.id] ?? { total: 0, aut: 0, rec: 0, ruta: 0 };
                const abre = abierta === r.id;
                // Anillo de avance: la proporción resuelta del turno de un
                // vistazo, sin tener que leer cuatro cifras y compararlas.
                const hecho = c.total ? (c.aut + c.rec) / c.total : 0;
                const R = 26, C = 2 * Math.PI * R;
                const tono = c.rec > 0 ? "at-bad" : c.ruta > 0 ? "at-ruta" : "at-ok";
                return (
                  <Link key={r.id} href={enlace({ abierta: abre ? "" : r.id })}
                    className={"burbuja " + tono + (abre ? " abierta" : "")}>
                    <div className="burbuja-cab">
                      <div className="burbuja-anillo">
                        <svg viewBox="0 0 64 64" aria-hidden="true">
                          <circle cx="32" cy="32" r={R} className="pista" />
                          <circle cx="32" cy="32" r={R} className="avance"
                            strokeDasharray={`${(C * hecho).toFixed(1)} ${C.toFixed(1)}`} />
                        </svg>
                        <span className="burbuja-total">{c.total}</span>
                      </div>
                      <div className="burbuja-id">
                        <span className="burbuja-nombre">{r.label}</span>
                        <span className="burbuja-meta">
                          Ronda #{r.round_number} · {fmtDateTime(r.started_at)}
                        </span>
                        {r.responsible && <span className="burbuja-meta">{r.responsible}</span>}
                      </div>
                      {r.status === "open" && <span className="punto-vivo" title="Ronda abierta" />}
                    </div>
                    <div className="burbuja-cifras">
                      <span><b>{c.aut}</b> autorizadas</span>
                      {c.rec > 0 && <span className="c-bad"><b>{c.rec}</b> no autorizadas</span>}
                      {c.ruta > 0 && <span className="c-ruta"><b>{c.ruta}</b> en ruta</span>}
                    </div>
                    <span className="burbuja-pie">{abre ? "Cerrar detalle" : "Ver detalle"}</span>
                  </Link>
                );
              })}
            </div>

            {abierta && (
              <div className="detalle-ronda">
                <div className="panel-head">
                  <div>
                    <div className="panel-title">
                      {rondasVisibles.find((r) => r.id === abierta)?.label ?? "Ronda"}
                    </div>
                    <div className="panel-sub">{filas.length} inspección(es) en este turno</div>
                  </div>
                  <Link className="btn btn-ghost btn-sm" href={enlace({ abierta: "" })}>Cerrar</Link>
                </div>
                {filas.length ? <Tabla rs={filas} />
                  : <div className="empty-state">Esta ronda no tiene inspecciones que coincidan con los filtros.</div>}
              </div>
            )}
          </>
        ) : <div className="stub"><h3>Sin rondas</h3><p>No hay rondas que coincidan con estos filtros.</p></div>
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
