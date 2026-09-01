// Configuración de las pruebas automatizadas.
//
// Alcance deliberado: se prueba la LÓGICA PURA (reglas del checklist, formato,
// traducción de errores, redimensionado de imágenes). Esa lógica es la que puede
// romperse en silencio y la que decide lo que ve el conductor.
//
// Las reglas de negocio críticas (autorizar o bloquear una salida) NO se prueban
// aquí porque no viven en el cliente: las recalcula PostgreSQL. Probarlas de
// verdad exige la base de datos, y hacerlo contra un doble de prueba daría una
// falsa sensación de seguridad.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/types.ts", "lib/supabase/**"],
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
