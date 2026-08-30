import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import ConfigClient from "./config-client";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const supabase = createClient();
  const [{ data: cats }, { data: versions }, { data: org }] = await Promise.all([
    supabase.from("checklist_categories").select("id,key,name,icon,sort_order,active,checklist_items(id,name,item_type,required,is_safety_critical,active,sort_order)").order("sort_order"),
    supabase.from("checklist_versions").select("id,version_number,active,note,created_at").order("version_number", { ascending: false }).limit(20),
    supabase.from("organizations").select("id,name,max_non_critical_bad,timezone").maybeSingle(),
  ]);
  const active = (versions ?? []).find((v) => v.active);

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="panel-title">Checklist de inspección</div>
            <div className="panel-sub" style={{ margin: 0 }}>
              Versión activa: <b>v{active?.version_number ?? "—"}</b>. Editar no altera inspecciones históricas:
              publique una nueva versión para aplicar cambios.
            </div>
          </div>
        </div>
      </div>

      <ConfigClient
        categories={(cats ?? []) as any}
        org={org as any}
        versions={(versions ?? []) as any}
      />

      <div className="panel">
        <div className="panel-title">Historial de versiones</div>
        <div className="tbl-wrap" style={{ marginTop: 12 }}>
          <table className="tbl">
            <thead><tr><th>Versión</th><th>Estado</th><th>Nota</th><th>Creada</th></tr></thead>
            <tbody>
              {(versions ?? []).map((v) => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 700 }}>v{v.version_number}</td>
                  <td>{v.active ? <span className="badge ok">Activa</span> : <span className="badge neutral">Archivada</span>}</td>
                  <td className="cell-sub">{v.note || "—"}</td>
                  <td className="cell-sub">{fmtDateTime(v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
