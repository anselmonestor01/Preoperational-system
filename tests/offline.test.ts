// Modo sin conexión.
//
// Se prueba `esErrorDeRed` porque de ella depende una decisión delicada: un
// fallo de red debe reintentarse, pero un RECHAZO del servidor ("el vehículo
// está bloqueado") no, porque la respuesta será siempre la misma y la cola
// entraría en un bucle infinito reenviando algo que nunca va a aceptarse.
import { describe, it, expect, afterEach, vi } from "vitest";
import { esErrorDeRed, offlineDisponible } from "@/lib/offline";

afterEach(() => vi.unstubAllGlobals());

describe("esErrorDeRed — se reintenta o no", () => {
  it("reconoce los fallos de red típicos del navegador", () => {
    const fallos = [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource",
      "network error",
      "Load failed",
      "timeout of 5000ms exceeded",
      "net::ERR_INTERNET_DISCONNECTED",
    ];
    for (const m of fallos) {
      expect(esErrorDeRed(new Error(m))).toBe(true);
    }
  });

  it("NO trata como red los rechazos de negocio (evita el bucle de reintentos)", () => {
    const rechazos = [
      "El vehículo está bloqueado por administración",
      "No hay una ronda abierta",
      "No autorizado",
      "La contraseña no es correcta",
      "duplicate key value violates unique constraint",
    ];
    for (const m of rechazos) {
      expect(esErrorDeRed(new Error(m))).toBe(false);
    }
  });

  it("si el navegador se declara sin conexión, cualquier error cuenta como de red", () => {
    // Estando sin señal, hasta un error ambiguo debe reintentarse: la
    // inspección del conductor no se puede perder.
    vi.stubGlobal("navigator", { onLine: false });
    expect(esErrorDeRed(new Error("algo ambiguo"))).toBe(true);
    expect(esErrorDeRed(null)).toBe(true);
  });

  it("con conexión, un error ambiguo NO se reintenta", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(esErrorDeRed(new Error("algo ambiguo"))).toBe(false);
  });

  it("no revienta con entradas inesperadas", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(esErrorDeRed(undefined)).toBe(false);
    expect(esErrorDeRed({})).toBe(false);
    expect(esErrorDeRed("Failed to fetch")).toBe(true);
  });
});

describe("offlineDisponible", () => {
  it("informa que no hay soporte cuando el navegador carece de IndexedDB", () => {
    // En Node no existe indexedDB: la aplicación debe seguir funcionando en
    // línea en vez de romperse.
    expect(offlineDisponible()).toBe(false);
  });

  it("informa que sí hay soporte cuando IndexedDB existe", () => {
    vi.stubGlobal("indexedDB", {} as IDBFactory);
    expect(offlineDisponible()).toBe(true);
  });
});
