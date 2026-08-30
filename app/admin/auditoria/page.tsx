import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const PAGE = 40;

const ACTION_LABELS: Record<string, string> = {
  inspection_submitted: "Inspección enviada",
  operation_closed: "Operación cerrada",
  vehicle_blocked: "Vehículo bloqueado",
  vehicle_unblocked: "Vehículo desbloqueado",
  override_authorization: "Override de autorización",
  issue_status_changed: "Novedad actualizada",
  inspection_voided: "Inspección anulada",
  inspection_released: "Vehículo liberado",
  round_started: "Ronda iniciada",
  round_closed: "Ronda cerrada",
  checklist_published: "Checklist publicado",
  driver_created: "Conductor creado",
  driver_pin_changed: "PIN de conductor cambiado",
  driver_pin_ok: "PIN verificado (OK)",
  driver_pin_failed: "PIN incorrecto",
};

export default async function AuditoriaPage({ searchParams }: { searchParams: { page?: string } }) {
  const supabase = createClient();
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const { data, count } = await supabase
    .from("audit_logs")
    .select("id,action,actor_label,entity_type,entity_id,new_value,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <div className="panel" style={{ padding: 14 }}>
        <div className="panel-sub" style={{ margin: 0 }}>
          Registro inmutable de acciones críticas (append-only). Sólo visible para administradores y auditores.
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Fecha</th><th>Acción</th><th>Actor</th><th>Entidad</th><th>Detalle</th></tr></thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
                <td><span className="badge neutral">{ACTION_LABELS[r.action] ?? r.action}</span></td>
                <td className="cell-sub">{r.actor_label ?? "sistema"}</td>
                <td className="cell-sub">{r.entity_type ?? "—"}</td>
                <td className="cell-sub" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.new_value ? JSON.stringify(r.new_value) : "—"}
                </td>
              </tr>
            ))}
            {(data ?? []).length === 0 && <tr><td colSpan={5}><div className="stub"><p>Sin registros de auditoría todavía.</p></div></td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <div className="cell-sub">{count ?? 0} registro(s) · página {page} de {totalPages}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {page > 1 && <Link className="btn btn-ghost btn-sm" href={`/admin/auditoria?page=${page - 1}`}>← Anterior</Link>}
          {page < totalPages && <Link className="btn btn-ghost btn-sm" href={`/admin/auditoria?page=${page + 1}`}>Siguiente →</Link>}
        </div>
      </div>
    </>
  );
}
