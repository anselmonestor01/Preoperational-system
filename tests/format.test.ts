// Formato de datos que se muestran al usuario.
// Todo se presenta en zona horaria de Colombia porque la operación es local:
// mostrar UTC haría que una inspección de la noche apareciera al día siguiente.
import { describe, it, expect, vi, afterEach } from "vitest";
import { fmtDate, fmtTime, fmtDateTime, fmtNum, fmtKm, initials } from "@/lib/format";

describe("valores ausentes", () => {
  it("nunca imprime 'null' ni 'undefined' en pantalla", () => {
    for (const fn of [fmtDate, fmtTime, fmtDateTime, fmtNum, fmtKm]) {
      expect(fn(null as never)).toBe("—");
      expect(fn(undefined as never)).toBe("—");
    }
  });

  it("fmtNum distingue el cero de la ausencia de dato", () => {
    // 0 km recorridos es un dato real; no debe mostrarse como "—".
    expect(fmtNum(0)).toBe("0");
    expect(fmtKm(0)).toBe("0 km");
  });
});

describe("fecha y hora en zona Colombia", () => {
  // 2026-01-15T02:30:00Z son las 21:30 del 14 de enero en Bogotá (UTC-5).
  const iso = "2026-01-15T02:30:00.000Z";

  it("convierte a la fecha local, no a la UTC", () => {
    expect(fmtDate(iso)).toBe("14/01/2026");
  });

  it("convierte a la hora local", () => {
    expect(fmtTime(iso)).toBe("09:30 p. m.");
  });

  it("fmtDateTime combina ambas", () => {
    expect(fmtDateTime(iso)).toBe(`${fmtDate(iso)} ${fmtTime(iso)}`);
  });
});

describe("fmtKm", () => {
  it("agrupa los miles para que un kilometraje largo sea legible", () => {
    expect(fmtKm(152300)).toContain("km");
    expect(fmtKm(152300).replace(/\s|km/g, "")).toMatch(/152.300/);
  });
});

describe("initials — iniciales del avatar", () => {
  it("toma la inicial del nombre y del apellido", () => {
    expect(initials("Juan Pérez")).toBe("JP");
  });

  it("con un solo nombre devuelve una letra", () => {
    expect(initials("Ana")).toBe("A");
  });

  it("con más de dos palabras usa sólo las dos primeras", () => {
    expect(initials("Juan Carlos Pérez Gómez")).toBe("JC");
  });

  it("ignora espacios sobrantes en vez de devolver iniciales vacías", () => {
    // Sin normalizar, "  Juan Pérez" produce iniciales vacías porque las dos
    // primeras posiciones del split son cadenas vacías.
    expect(initials("  Juan Pérez")).toBe("JP");
    expect(initials("Juan   Pérez")).toBe("JP");
    expect(initials(" Ana ")).toBe("A");
  });

  it("no revienta con una cadena vacía", () => {
    expect(initials("")).toBe("");
    expect(initials("   ")).toBe("");
  });
});

// Regresión: el panel se renderiza en el servidor y se hidrata en el cliente.
// Node y Chrome producen "02:14 p. m." con un byte distinto entre "p." y "m."
// (espacio normal contra espacio duro U+00A0), y esa diferencia invisible hacía
// que React descartara el HTML del servidor en TODAS las pantallas con fechas.
//
// La prueba NO puede comprobar la salida real de Node: Node emite el espacio
// normal, así que pasaría igual con el fallo presente. Lo que se comprueba es
// que el formateador limpia lo que le llegue, simulando la salida de Chrome.
describe("estabilidad entre servidor y navegador", () => {
  const DURO = "\u00A0";

  afterEach(() => vi.restoreAllMocks());

  it("la hora limpia el espacio duro que produce el navegador", () => {
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue(`02:14 p.${DURO}m.`);
    expect(fmtTime("2026-09-01T19:14:00.000Z")).toBe("02:14 p. m.");
  });

  it("la fecha también", () => {
    vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue(`01${DURO}sep${DURO}2026`);
    expect(fmtDate("2026-09-01T19:14:00.000Z")).toBe("01 sep 2026");
  });

  it("y los números", () => {
    vi.spyOn(Number.prototype, "toLocaleString").mockReturnValue(`1${DURO}234${DURO}567`);
    expect(fmtNum(1234567)).toBe("1 234 567");
  });

  it("sigue mostrando la hora correcta de Colombia", () => {
    // 19:14 UTC son las 14:14 en Bogotá (UTC-5).
    expect(fmtTime("2026-09-01T19:14:00.000Z")).toContain("02:14");
  });
});
