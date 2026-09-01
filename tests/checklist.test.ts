// Reglas del checklist.
//
// Estas funciones son el ESPEJO en el cliente de `app.severity_of` en PostgreSQL.
// Si se desincronizan, el conductor ve un resultado distinto al que el servidor
// va a registrar: por eso cada valor se prueba explícitamente contra la tabla
// de verdad definida en la migración 0001.
import { describe, it, expect } from "vitest";
import { ITEM_OPTIONS, optionsFor, severityOf, labelOf, previewResult } from "@/lib/checklist";
import type { ItemType } from "@/lib/types";

describe("severityOf — espejo de app.severity_of en la base de datos", () => {
  const casos: [ItemType, string, string][] = [
    ["nivel", "lleno", "ok"],
    ["nivel", "medio", "warn"],
    ["nivel", "bajo", "warn"],
    ["nivel", "vacio", "bad"],
    ["estado", "bueno", "ok"],
    ["estado", "regular", "warn"],
    ["estado", "malo", "bad"],
    ["equipo", "tiene", "ok"],
    ["equipo", "incompleto", "warn"],
    ["equipo", "no_tiene", "bad"],
  ];

  it.each(casos)("%s = %s → %s", (tipo, valor, esperado) => {
    expect(severityOf(tipo, valor)).toBe(esperado);
  });

  it("devuelve null ante un valor desconocido en vez de inventar una severidad", () => {
    expect(severityOf("estado", "cualquier-cosa")).toBeNull();
    expect(severityOf("nivel", "")).toBeNull();
  });
});

describe("optionsFor", () => {
  it("devuelve las opciones del tipo pedido", () => {
    expect(optionsFor("nivel")).toHaveLength(4);
    expect(optionsFor("estado")).toHaveLength(3);
    expect(optionsFor("equipo")).toHaveLength(3);
  });

  it("ante un tipo desconocido cae en 'estado' y nunca deja al conductor sin opciones", () => {
    const opciones = optionsFor("inexistente" as ItemType);
    expect(opciones).toEqual(ITEM_OPTIONS.estado);
  });

  it("toda opción tiene una severidad válida", () => {
    for (const opciones of Object.values(ITEM_OPTIONS)) {
      for (const o of opciones) {
        expect(["ok", "warn", "bad"]).toContain(o.sev);
        expect(o.value).not.toBe("");
        expect(o.label).not.toBe("");
      }
    }
  });

  it("cada tipo tiene exactamente una opción 'ok' (no puede haber dos respuestas buenas)", () => {
    for (const opciones of Object.values(ITEM_OPTIONS)) {
      expect(opciones.filter((o) => o.sev === "ok")).toHaveLength(1);
    }
  });
});

describe("labelOf", () => {
  it("traduce el valor guardado a la etiqueta que se muestra", () => {
    expect(labelOf("estado", "malo")).toBe("Malo");
    expect(labelOf("equipo", "no_tiene")).toBe("No tiene");
  });

  it("devuelve cadena vacía si el valor no existe (no rompe la interfaz)", () => {
    expect(labelOf("estado", "zzz")).toBe("");
  });
});

describe("previewResult — resultado que se le anticipa al conductor", () => {
  it("sin hallazgos es 'bueno'", () => {
    expect(previewResult({ warn: 0, bad: 0 })).toBe("bueno");
  });

  it("cualquier hallazgo grave hace que sea 'malo', aunque haya muchos leves", () => {
    expect(previewResult({ warn: 0, bad: 1 })).toBe("malo");
    expect(previewResult({ warn: 99, bad: 1 })).toBe("malo");
  });

  it("sólo hallazgos leves es 'regular'", () => {
    expect(previewResult({ warn: 1, bad: 0 })).toBe("regular");
    expect(previewResult({ warn: 50, bad: 0 })).toBe("regular");
  });

  it("un solo hallazgo grave nunca se degrada a 'regular' (regla de seguridad)", () => {
    // Es la propiedad que protege la vida: basta UN ítem grave para que no sea
    // ni 'bueno' ni 'regular'. El servidor aplica la misma regla.
    for (let leves = 0; leves < 20; leves++) {
      expect(previewResult({ warn: leves, bad: 1 })).toBe("malo");
    }
  });
});
