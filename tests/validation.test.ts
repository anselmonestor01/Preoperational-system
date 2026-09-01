// Validación de los datos que escribe el usuario.
//
// Estas pruebas fijan el contrato con las restricciones CHECK de PostgreSQL:
// si el cliente aceptara algo que la base rechaza, el usuario llenaría un
// formulario completo para recibir un error incomprensible al enviarlo.
import { describe, it, expect } from "vitest";
import {
  LIMITES, KM_MAX, WHATSAPP_DIGITOS, soloDigitos, soloTelefono, soloPlaca, limpiarTexto,
  kmValido, kmRegresoValido, textoValido, telefonoValido, licenciaValida, pinValido,
} from "@/lib/validation";

describe("filtrado de escritura", () => {
  it("el kilometraje descarta cualquier cosa que no sea un dígito", () => {
    expect(soloDigitos("12a34")).toBe("1234");
    expect(soloDigitos("abc")).toBe("");
    expect(soloDigitos("1.234,56")).toBe("123456");
    // Un intento de inyectar un script simplemente no deja nada escribible.
    expect(soloDigitos("<script>alert(1)</script>")).toBe("1");
  });

  it("el teléfono admite dígitos y símbolos telefónicos, nunca letras", () => {
    expect(soloTelefono("+57 (300) 680-8029")).toBe("+57 (300) 680-8029");
    expect(soloTelefono("300abc680")).toBe("300680");
  });

  it("la placa queda en mayúsculas y sin símbolos extraños", () => {
    expect(soloPlaca("abc-123")).toBe("ABC-123");
    expect(soloPlaca("ab<>c/123")).toBe("ABC123");
  });

  it("el texto libre colapsa espacios y respeta el tope", () => {
    expect(limpiarTexto("Juan    Pérez", 80)).toBe("Juan Pérez");
    expect(limpiarTexto("A".repeat(500), 80)).toHaveLength(80);
  });
});

describe("kilometraje", () => {
  it("acepta enteros dentro del rango, incluido el cero", () => {
    expect(kmValido(0)).toBe(true);
    expect(kmValido(152300)).toBe(true);
    expect(kmValido(KM_MAX)).toBe(true);
  });

  it("rechaza negativos, decimales, vacíos y valores imposibles", () => {
    expect(kmValido(-1)).toBe(false);
    expect(kmValido(1.5)).toBe(false);
    expect(kmValido("")).toBe(false);
    expect(kmValido(null)).toBe(false);
    expect(kmValido(KM_MAX + 1)).toBe(false);
    expect(kmValido("abc")).toBe(false);
  });

  it("el regreso nunca puede tener menos kilómetros que la salida", () => {
    // El caso que el usuario reportó: salió con 10.000, "regresó" con 5.000.
    expect(kmRegresoValido(10000, 5000)).toBe(false);
    expect(kmRegresoValido(10000, 10000)).toBe(true);
    expect(kmRegresoValido(10000, 10250)).toBe(true);
  });

  it("sin ambos datos no se puede validar el recorrido", () => {
    expect(kmRegresoValido(null, 100)).toBe(false);
    expect(kmRegresoValido(100, null)).toBe(false);
  });
});

describe("textos con mínimo obligatorio", () => {
  it("un nombre de conductor de una letra no es un nombre", () => {
    expect(textoValido("X", LIMITES.nombreConductor)).toBe(false);
    expect(textoValido("Ana Gómez", LIMITES.nombreConductor)).toBe(true);
  });

  it("sólo espacios no cuenta como dato", () => {
    expect(textoValido("   ", LIMITES.nombreConductor)).toBe(false);
    expect(textoValido("   ", LIMITES.nombreRonda)).toBe(false);
  });

  it("rechaza cargas enormes (el vector de denegación de servicio)", () => {
    expect(textoValido("A".repeat(500000), LIMITES.nombreConductor)).toBe(false);
    expect(textoValido("A".repeat(2000), LIMITES.observaciones)).toBe(false);
  });

  it("el nombre de la ronda exige un mínimo real", () => {
    expect(textoValido("AB", LIMITES.nombreRonda)).toBe(false);
    expect(textoValido("Turno mañana", LIMITES.nombreRonda)).toBe(true);
  });
});

describe("campos opcionales", () => {
  it("teléfono vacío es válido; con letras no", () => {
    expect(telefonoValido("")).toBe(true);
    expect(telefonoValido("   ")).toBe(true);
    expect(telefonoValido("+57 300 680 8029")).toBe(true);
    expect(telefonoValido("no-es-telefono")).toBe(false);
    expect(telefonoValido("123")).toBe(false); // demasiado corto
  });

  // El servidor cuenta dígitos (7 a 15, norma E.164). Si el navegador contara
  // caracteres, un número escrito con espacios se rechazaría aquí aunque el
  // servidor lo aceptara, y uno de 18 dígitos pasaría aquí para fallar allá.
  it("el teléfono se mide en dígitos, no en caracteres escritos", () => {
    expect(WHATSAPP_DIGITOS).toEqual({ min: 7, max: 15 });

    // El mismo número, escrito de tres formas: las tres válidas.
    expect(telefonoValido("573011987446")).toBe(true);
    expect(telefonoValido("+57 301 198 7446")).toBe(true);
    expect(telefonoValido("+57 (301) 198-7446")).toBe(true);

    // Ni uno más corto que un número local ni uno más largo que E.164.
    expect(telefonoValido("123456")).toBe(false);
    expect(telefonoValido("1234567890123456")).toBe(false);

    // Y ningún acompañante raro, por bonito que se vea.
    expect(telefonoValido("300 680 8029 ext. 4")).toBe(false);
  });

  it("licencia vacía es válida; de dos caracteres no", () => {
    expect(licenciaValida("")).toBe(true);
    expect(licenciaValida("1032876456")).toBe(true);
    expect(licenciaValida("AB")).toBe(false);
    expect(licenciaValida("A".repeat(40))).toBe(false);
  });
});

describe("PIN del conductor", () => {
  it("exige exactamente cuatro dígitos", () => {
    expect(pinValido("1234")).toBe(true);
    expect(pinValido("123")).toBe(false);
    expect(pinValido("12345")).toBe(false);
    expect(pinValido("12a4")).toBe(false);
    expect(pinValido("")).toBe(false);
  });
});
