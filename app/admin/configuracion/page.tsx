// Configuración: checklist activo y parámetros de operación de la organización.
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import ConfigClient from "./config-client";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const supabase = createClient();
  const perfil = await getProfile();
  const [{ data: cats }, { data: versions }, { data: org }] = await Promise.all([
    supabase.from("checklist_categories")
      .select("id,key,name,icon,sort_order,active,checklist_items(id,name,item_type,required,is_safety_critical,active,sort_order)")
      .order("sort_order"),
    supabase.from("checklist_versions").select("id,version_number,active,note,created_at").order("version_number", { ascending: false }).limit(20),
    // Filtrado por la empresa activa: un superadministrador ve varias, y sin
    // este filtro `maybeSingle()` fallaría con "multiple rows returned".
    supabase.from("organizations").select("id,name,max_non_critical_bad,timezone")
      .eq("id", perfil?.organization_id ?? "").maybeSingle(),
  ]);
  const active = (versions ?? []).find((v) => v.active);

  return (
    <>
      <ConfigClient categories={(cats ?? []) as any} org={org as any} activeVersion={active?.version_number ?? null} />

      <div className="panel">
        <div className="panel-head"><div><div className="panel-title">Historial de versiones del checklist</div>
          <div className="panel-sub">Cada inspección conserva la versión con la que se realizó; publicar una nueva no altera el historial.</div></div></div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Versión</th><th>Estado</th><th>Nota</th><th>Creada</th></tr></thead>
            <tbody>
              {(versions ?? []).map((v) => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 700 }}>Versión {v.version_number}</td>
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
