// Traducción de errores técnicos a mensajes para el usuario.
//
// Importa por dos motivos opuestos: un conductor no debe leer jerga de Postgres,
// pero un mensaje de negocio escrito a propósito en los RPC ("El vehículo está
// bloqueado") SÍ debe llegar intacto, porque explica por qué no puede salir.
import { describe, it, expect, vi, afterEach } from "vitest";
import { friendlyError } from "@/lib/errors";

afterEach(() => vi.restoreAllMocks());

/** Así llega a Supabase un `raise exception` de PL/pgSQL. */
const reglaDeNegocio = (message: string) => ({ code: "P0001", message });

describe("mensajes de negocio en español", () => {
  it("deja pasar intactos los mensajes escritos para el usuario en los RPC", () => {
    const mensajes = [
      "No autorizado",
      "No hay una ronda abierta",
      "Vehículo no encontrado",
      "Conductor no encontrado",
      "El PIN no es correcto",
      "Motivo obligatorio",
      "Inspección no encontrada",
    ];
    for (const m of mensajes) {
      expect(friendlyError(reglaDeNegocio(m))).toBe(m);
    }
  });

  // Regresión: al borrar una ronda con la contraseña equivocada el sistema
  // mostraba "No fue posible eliminar la ronda" y el administrador no tenía
  // forma de saber que el problema era la contraseña.
  it("explica que la contraseña está mal en vez de dar un error genérico", () => {
    expect(friendlyError(reglaDeNegocio("La contraseña no es correcta"),
      "No fue posible eliminar la ronda.")).toBe("La contraseña no es correcta");
  });

  it("no inventa mensajes de negocio a partir de errores técnicos", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Sin el código P0001 no es una regla de negocio: no se muestra tal cual.
    expect(friendlyError({ message: "algo interno del servidor" }, "Respaldo."))
      .toBe("Respaldo.");
  });
});

describe("errores técnicos", () => {
  it("nunca muestra jerga de base de datos al usuario", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const tecnicos = [
      "duplicate key value violates unique constraint",
      "insert or update on table violates foreign key constraint",
      "JSON object requested, multiple (or no) rows returned",
      'null value in column "x" violates not-null constraint',
    ];
    for (const m of tecnicos) {
      const salida = friendlyError({ message: m });
      expect(salida).not.toContain("constraint");
      expect(salida).not.toContain("violates");
      expect(salida).not.toContain("JSON");
    }
  });

  it("traduce el permiso denegado", () => {
    expect(friendlyError({ message: "permission denied for table drivers" }))
      .toBe("No tienes permiso para realizar esta acción.");
  });

  it("traduce la clave duplicada", () => {
    expect(friendlyError({ message: "duplicate key value" })).toBe("Ese registro ya existe.");
    expect(friendlyError({ code: "23505", message: "..." })).toBe("Ese registro ya existe.");
  });

  it("traduce la violación de llave foránea", () => {
    expect(friendlyError({ message: "foreign key violation" }))
      .toBe("No se puede completar: hay información relacionada que depende de este registro.");
  });

  it("avisa cuando la sesión expiró para que el usuario sepa qué hacer", () => {
    expect(friendlyError({ message: "JWT expired" }))
      .toBe("Tu sesión expiró. Vuelve a iniciar sesión.");
  });

  it("distingue un problema de red para que el usuario sepa reintentar", () => {
    expect(friendlyError({ message: "Failed to fetch" }))
      .toBe("Problema de conexión. Verifica tu red e intenta de nuevo.");
    expect(friendlyError({ message: "network error" }))
      .toBe("Problema de conexión. Verifica tu red e intenta de nuevo.");
  });
});

describe("robustez", () => {
  it("usa el mensaje de respaldo ante entradas inesperadas", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const respaldo = "Ocurrió un error. Intenta nuevamente.";
    expect(friendlyError(null)).toBe(respaldo);
    expect(friendlyError(undefined)).toBe(respaldo);
    expect(friendlyError({})).toBe(respaldo);
    expect(friendlyError(new Error("algo raro"))).toBe(respaldo);
  });

  it("respeta un mensaje de respaldo personalizado", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(friendlyError({}, "No se pudo eliminar el vehículo."))
      .toBe("No se pudo eliminar el vehículo.");
  });

  it("registra el detalle técnico en consola para diagnóstico", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    friendlyError(new Error("detalle interno"));
    expect(spy).toHaveBeenCalled();
  });
});
