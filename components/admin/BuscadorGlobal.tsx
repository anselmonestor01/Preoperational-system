"use client";

// Buscador global del panel.
//
// POR QUÉ EXISTE
// A escala, la pregunta más frecuente no empieza en un módulo: empieza con una
// placa apuntada en un papel o un nombre que alguien menciona por radio. Antes
// había que adivinar en qué pestaña vivía la respuesta y buscar allí. Ahora se
// escribe desde cualquier pantalla y el resultado lleva directo a la ficha.
//
// Busca sobre lo que ya está cargado en memoria del navegador —placas,
// conductores y rondas se traen una vez al montar el panel— porque son listas
// pequeñas y acotadas por RLS a la empresa activa. Consultar al servidor en
// cada tecla sería mucho gasto para muy poca ganancia.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Resultado = {
  tipo: "vehiculo" | "conductor" | "ronda";
  id: string; titulo: string; sub: string; destino: string;
};

const ETIQUETA: Record<Resultado["tipo"], string> = {
  vehiculo: "Vehículo", conductor: "Conductor", ronda: "Ronda",
};

export default function BuscadorGlobal() {
  const supabase = createClient();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const [fuente, setFuente] = useState<Resultado[]>([]);
  const caja = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: v }, { data: c }, { data: r }] = await Promise.all([
        supabase.from("vehicle_status_view").select("id,plate,availability,reference").order("plate"),
        supabase.from("drivers").select("id,full_name,license,active").order("full_name"),
        supabase.from("rounds").select("id,label,round_number,status").order("round_number", { ascending: false }).limit(60),
      ]);
      if (!vivo) return;
      const todo: Resultado[] = [
        ...(v ?? []).map((x: any) => ({
          tipo: "vehiculo" as const, id: x.id, titulo: x.plate,
          sub: x.availability === "available" ? "disponible"
            : x.availability === "issues" ? "con novedades"
            : x.availability === "admin_blocked" ? "bloqueado"
            : x.reference || "unidad",
          destino: `/admin/vehiculos?f=todos`,
        })),
        ...(c ?? []).map((x: any) => ({
          tipo: "conductor" as const, id: x.id, titulo: x.full_name,
          sub: x.active ? (x.license ? `licencia ${x.license}` : "activo") : "inactivo",
          destino: `/admin/reportes?vista=detalle&driver=${x.id}`,
        })),
        ...(r ?? []).map((x: any) => ({
          tipo: "ronda" as const, id: x.id, titulo: x.label,
          sub: `ronda #${x.round_number}${x.status === "open" ? " · abierta" : ""}`,
          destino: `/admin/inspecciones?ronda=${x.id}`,
        })),
      ];
      setFuente(todo);
    })();
    return () => { vivo = false; };
  }, [supabase]);

  // Atajo de teclado: la barra sirve de poco si hay que buscarla con el ratón.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); caja.current?.focus(); setAbierto(true);
      }
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, []);

  const resultados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return fuente
      .filter((r) => r.titulo.toLowerCase().includes(t) || r.sub.toLowerCase().includes(t))
      // Coincidencia por el principio primero: quien escribe «ZZZ» busca
      // ZZZ-001, no una referencia que la contenga por casualidad.
      .sort((a, b) => Number(b.titulo.toLowerCase().startsWith(t)) - Number(a.titulo.toLowerCase().startsWith(t)))
      .slice(0, 8);
  }, [fuente, q]);

  function ir(r: Resultado) {
    setAbierto(false); setQ("");
    router.push(r.destino);
  }

  return (
    <div className="buscador" style={{ width: 230 }}>
      <input ref={caja} className="manage-input" style={{ width: "100%" }}
        placeholder="Buscar placa, conductor o ronda…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setAbierto(true); setMarcado(0); }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => {
          if (!resultados.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setMarcado((m) => (m + 1) % resultados.length); }
          if (e.key === "ArrowUp") { e.preventDefault(); setMarcado((m) => (m - 1 + resultados.length) % resultados.length); }
          if (e.key === "Enter") { e.preventDefault(); ir(resultados[marcado]); }
        }} />
      {abierto && resultados.length > 0 && (
        <div className="sugerencias">
          {resultados.map((r, i) => (
            <button key={r.tipo + r.id} className={"sugerencia " + (i === marcado ? "marcada" : "")}
              onMouseEnter={() => setMarcado(i)}
              onMouseDown={(e) => { e.preventDefault(); ir(r); }}>
              <span className="badge neutral" style={{ fontSize: 10 }}>{ETIQUETA[r.tipo]}</span>
              <span style={{ fontWeight: 600 }}>{r.titulo}</span>
              <span className="sugerencia-sub">{r.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
