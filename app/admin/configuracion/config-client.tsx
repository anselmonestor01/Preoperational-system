"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ItemType } from "@/lib/types";

type Item = { id: string; name: string; item_type: ItemType; required: boolean; is_safety_critical: boolean; active: boolean; sort_order: number };
type Cat = { id: string; key: string; name: string; icon: string; sort_order: number; active: boolean; checklist_items: Item[] };
type Org = { id: string; name: string; max_non_critical_bad: number; timezone: string };

export default function ConfigClient({ categories, org }: { categories: Cat[]; org: Org; versions: any[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [maxBad, setMaxBad] = useState(org?.max_non_critical_bad ?? 3);
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  async function updateItem(id: string, patch: Partial<Item>) {
    const { error } = await supabase.from("checklist_items").update(patch).eq("id", id);
    if (error) return show(error.message);
    router.refresh();
  }
  async function addItem(cat: Cat) {
    const name = window.prompt("Nombre del nuevo ítem:");
    if (!name?.trim()) return;
    const type = (window.prompt("Tipo (estado / nivel / equipo):", "estado") ?? "estado").trim() as ItemType;
    if (!["estado", "nivel", "equipo"].includes(type)) return show("Tipo inválido");
    const { error } = await supabase.from("checklist_items").insert({
      organization_id: org.id, category_id: cat.id, name: name.trim(), item_type: type,
      sort_order: (cat.checklist_items?.length ?? 0) + 1,
    });
    if (error) return show(error.message);
    show("Ítem agregado"); router.refresh();
  }
  async function addCategory() {
    const name = window.prompt("Nombre de la nueva categoría:");
    if (!name?.trim()) return;
    const key = name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_");
    const { error } = await supabase.from("checklist_categories").insert({
      organization_id: org.id, key, name: name.trim(), sort_order: categories.length + 1,
    });
    if (error) return show(error.message);
    show("Categoría agregada"); router.refresh();
  }
  async function publish() {
    const note = window.prompt("Nota de la nueva versión (ej. 'Se agregó ítem X'):") ?? "";
    if (!window.confirm("¿Publicar una nueva versión del checklist con el estado actual? Las inspecciones antiguas conservan su versión.")) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("publish_checklist_version", { p_note: note });
    setBusy(false);
    if (error) return show(error.message);
    show(`Versión v${data?.version_number} publicada`); router.refresh();
  }
  async function saveOrg() {
    setBusy(true);
    const { error } = await supabase.from("organizations").update({ max_non_critical_bad: Number(maxBad) }).eq("id", org.id);
    setBusy(false);
    if (error) return show(error.message);
    show("Parámetros guardados"); router.refresh();
  }

  return (
    <>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="panel-title" style={{ margin: 0 }}>Categorías y preguntas (borrador editable)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={addCategory}>+ Categoría</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={publish}>Publicar nueva versión</button>
          </div>
        </div>

        {categories.map((cat) => (
          <div key={cat.id} style={{ marginBottom: 18, border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ background: "#F7FAFD", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b>{cat.name}</b>
              <button className="btn btn-ghost btn-sm" onClick={() => addItem(cat)}>+ Ítem</button>
            </div>
            <div style={{ padding: "6px 14px" }}>
              {(cat.checklist_items ?? []).sort((a, b) => a.sort_order - b.sort_order).map((it) => (
                <div key={it.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 160, fontSize: 13.5, opacity: it.active ? 1 : 0.5 }}>{it.name}</span>
                  <span className="badge neutral">{it.item_type}</span>
                  <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}>
                    <input type="checkbox" checked={it.is_safety_critical} onChange={(e) => updateItem(it.id, { is_safety_critical: e.target.checked })} />
                    Crítico
                  </label>
                  <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}>
                    <input type="checkbox" checked={it.active} onChange={(e) => updateItem(it.id, { active: e.target.checked })} />
                    Activo
                  </label>
                </div>
              ))}
              {(cat.checklist_items ?? []).length === 0 && <div className="cell-sub" style={{ padding: "8px 0" }}>Sin ítems.</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-title">Parámetros de autorización</div>
        <div className="panel-sub">Cantidad de fallas en estado "Malo" NO críticas que, acumuladas, bloquean la salida.</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input className="input" type="number" min={1} max={50} value={maxBad}
            onChange={(e) => setMaxBad(Number(e.target.value))} style={{ width: 100 }} />
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={saveOrg}>Guardar</button>
        </div>
      </div>
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}
