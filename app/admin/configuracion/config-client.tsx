"use client";

// Editor del checklist y publicación de una versión nueva. Las inspecciones ya
// enviadas conservan su snapshot: editar aquí nunca reescribe el histórico.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import type { ItemType } from "@/lib/types";

type Item = { id: string; name: string; item_type: ItemType; required: boolean; is_safety_critical: boolean; active: boolean; sort_order: number };
type Cat = { id: string; key: string; name: string; icon: string; sort_order: number; active: boolean; checklist_items: Item[] };
type Org = { id: string; name: string; max_non_critical_bad: number; timezone: string };

const TYPE_LABEL: Record<ItemType, string> = { nivel: "Nivel", estado: "Bueno / Regular / Malo", equipo: "Tiene / Incompleto / No tiene" };

export default function ConfigClient({ categories, org, activeVersion }: { categories: Cat[]; org: Org; activeVersion: number | null }) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [maxBad, setMaxBad] = useState(org?.max_non_critical_bad ?? 3);
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };

  async function updateItem(id: string, patch: Partial<Item>) {
    const { error } = await supabase.from("checklist_items").update(patch).eq("id", id);
    if (error) return show(friendlyError(error));
    router.refresh();
  }
  async function addItem(cat: Cat, name: string, type: ItemType, critical: boolean) {
    if (!name.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      organization_id: org.id, category_id: cat.id, name: name.trim(), item_type: type,
      is_safety_critical: critical, sort_order: (cat.checklist_items?.length ?? 0) + 1,
    });
    if (error) return show(friendlyError(error));
    show("Pregunta agregada"); router.refresh();
  }
  async function removeItem(id: string) {
    if (!window.confirm("¿Quitar esta pregunta del checklist? (No afecta inspecciones ya realizadas.)")) return;
    const { error } = await supabase.from("checklist_items").update({ active: false }).eq("id", id);
    if (error) return show(friendlyError(error));
    show("Pregunta desactivada"); router.refresh();
  }
  async function addCategory() {
    const name = window.prompt("Nombre de la nueva etapa (categoría):");
    if (!name?.trim()) return;
    const key = name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_");
    const { error } = await supabase.from("checklist_categories").insert({ organization_id: org.id, key, name: name.trim(), sort_order: categories.length + 1 });
    if (error) return show(friendlyError(error));
    show("Etapa agregada"); router.refresh();
  }
  async function publish() {
    const note = window.prompt("Describe brevemente el cambio (ej. 'Se agregó revisión de extintor'):") ?? "";
    if (!window.confirm("¿Publicar una nueva versión del checklist con la estructura actual?\n\nLas inspecciones antiguas conservan su versión.")) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("publish_checklist_version", { p_note: note });
    setBusy(false);
    if (error) return show(friendlyError(error, "No fue posible publicar la versión."));
    show(`Versión ${data?.version_number} publicada`); router.refresh();
  }
  async function saveOrg() {
    setBusy(true);
    const { error } = await supabase.from("organizations").update({ max_non_critical_bad: Number(maxBad) }).eq("id", org.id);
    setBusy(false);
    if (error) return show(friendlyError(error));
    show("Parámetros guardados"); router.refresh();
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div><div className="panel-title">Checklist de inspección</div>
            <div className="panel-sub">Versión activa: <b>Versión {activeVersion ?? "—"}</b>. Ajusta las etapas y preguntas; al terminar, publica una nueva versión para aplicar los cambios.</div></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-ghost btn-sm" onClick={addCategory}>Nueva etapa</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={publish}>Publicar nueva versión</button>
          </div>
        </div>

        {categories.filter((c) => c.active).map((cat) => (
          <ConfigCategory key={cat.id} cat={cat} onUpdateItem={updateItem} onRemoveItem={removeItem} onAddItem={addItem} />
        ))}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Reglas de operación</div><div className="panel-sub">Cuándo un vehículo NO queda autorizado para salir</div></div></div>
          <div style={{ fontSize: 13.5, marginBottom: 10 }}>
            Una falla <b>crítica de seguridad</b> en estado “Malo” bloquea siempre la salida. Además, si se acumulan varias fallas “Malo” no críticas, el vehículo también se bloquea:
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="cell-sub">Máximo de fallas “Malo” no críticas permitidas:</span>
            <input className="manage-input" type="number" min={1} max={50} value={maxBad} onChange={(e) => setMaxBad(Number(e.target.value))} style={{ width: 90 }} />
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={saveOrg}>Guardar</button>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><div><div className="panel-title">Sistema</div><div className="panel-sub">Datos de la organización</div></div></div>
          <div className="summary-card">
            <div className="summary-row"><span className="cell-sub">Empresa</span><span>{org?.name}</span></div>
            <div className="summary-row"><span className="cell-sub">Zona horaria</span><span>{org?.timezone}</span></div>
          </div>
        </div>
      </div>
      <div className={"toast" + (toast ? " show" : "")}>{toast}</div>
    </>
  );
}

function ConfigCategory({ cat, onUpdateItem, onRemoveItem, onAddItem }: {
  cat: Cat;
  onUpdateItem: (id: string, patch: Partial<Item>) => void;
  onRemoveItem: (id: string) => void;
  onAddItem: (cat: Cat, name: string, type: ItemType, critical: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ItemType>("estado");
  const [critical, setCritical] = useState(false);
  const items = (cat.checklist_items ?? []).filter((i) => i.active).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="config-cat">
      <div className="config-cat-head">
        <div className="cat-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className="config-cat-name">{cat.name}</div>
      </div>
      <div className="manage-list">
        {items.map((it) => (
          <div key={it.id} className="manage-row manage-row-sm" style={{ flexWrap: "wrap", gap: 8 }}>
            <div className="manage-row-main" style={{ flex: "1 1 220px" }}>
              <span>{it.name}</span>
              <span className="badge info" style={{ fontSize: 9.5, marginLeft: 6 }}>{TYPE_LABEL[it.item_type]}</span>
              {it.is_safety_critical && <span className="badge bad" style={{ fontSize: 9.5, marginLeft: 4 }}>Crítico</span>}
            </div>
            <label className="cell-sub" style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <input type="checkbox" checked={it.is_safety_critical} onChange={(e) => onUpdateItem(it.id, { is_safety_critical: e.target.checked })} /> Crítico de seguridad
            </label>
            <button className="manage-remove" title="Quitar" onClick={() => onRemoveItem(it.id)}>✕</button>
          </div>
        ))}
        {items.length === 0 && <div className="empty-state" style={{ padding: 14 }}>Sin preguntas en esta etapa.</div>}
      </div>
      <div className="manage-add-row" style={{ flexWrap: "wrap" }}>
        <input className="manage-input" placeholder="Nueva pregunta para esta etapa" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { onAddItem(cat, name, type, critical); setName(""); setCritical(false); } }} />
        <select className="select manage-input" style={{ maxWidth: 210 }} value={type} onChange={(e) => setType(e.target.value as ItemType)}>
          <option value="estado">Bueno / Regular / Malo</option>
          <option value="nivel">Nivel (Lleno…Vacío)</option>
          <option value="equipo">Tiene / Incompleto / No tiene</option>
        </select>
        <label className="cell-sub" style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} /> Crítico
        </label>
        <button className="btn btn-primary btn-sm" onClick={() => { onAddItem(cat, name, type, critical); setName(""); setCritical(false); }}>Agregar</button>
      </div>
    </div>
  );
}
