// Marca de Preoperational System.
//
// POR QUÉ ES UN SVG EN CÓDIGO Y NO UNA IMAGEN
//  · Nítido en cualquier tamaño: el mismo dibujo sirve para el favicon de 28 px
//    y para el cartel impreso del patio, sin versiones sueltas que mantener.
//  · Pesa ~1,5 KB frente a los ~200 KB de un PNG, y no añade una petición más.
//  · Fondo transparente: sobre la barra lateral azul oscuro un PNG con recuadro
//    blanco se vería como un parche.
//  · Los colores se adaptan al fondo (`tone`) sin duplicar el archivo.

type Tone = "brand" | "light";

const PALETA: Record<Tone, { trazo: string; hueco: string; visto: string }> = {
  // Sobre fondo claro: azul marino corporativo.
  brand: { trazo: "#0B2545", hueco: "#FFFFFF", visto: "#2E6BB8" },
  // Sobre la barra lateral: el trazo se invierte y el visto se aclara para que
  // conserve contraste contra el azul oscuro.
  light: { trazo: "#FFFFFF", hueco: "#0B2545", visto: "#5C9BEE" },
};

export default function Logo({
  size = 40,
  tone = "brand",
  className,
}: {
  size?: number;
  tone?: Tone;
  className?: string;
}) {
  const c = PALETA[tone];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      className={className}
      role="img"
      aria-label="Preoperational System"
      shapeRendering="geometricPrecision"
    >
      {/* Hexágono: el contenedor de la marca */}
      <path
        d="M256 62 L424 160 L424 352 L256 450 L88 352 L88 160 Z"
        stroke={c.trazo}
        strokeWidth={28}
        strokeLinejoin="round"
      />

      {/* Camión: furgón y cabina */}
      <g fill={c.trazo}>
        <path d="M136 182 H206 V318 H136 Z" />
        <path d="M216 190 H330 a28 28 0 0 1 28 28 V318 H216 Z" />
      </g>

      {/* Huecos: separan furgón de cabina, abren parabrisas, rejilla y ruedas */}
      <g fill={c.hueco}>
        <rect x="202" y="176" width="12" height="148" />
        <path d="M232 206 H336 a10 10 0 0 1 10 10 v34 a10 10 0 0 1 -10 10 H230 a10 10 0 0 1 -10 -10 v-34 a10 10 0 0 1 10 -10 Z" />
        <rect x="238" y="278" width="100" height="12" rx="6" />
        <rect x="238" y="297" width="100" height="12" rx="6" />
        <circle cx="230" cy="320" r="31" />
        <circle cx="342" cy="320" r="31" />
      </g>

      <g fill={c.trazo}>
        <circle cx="230" cy="320" r="23" />
        <circle cx="342" cy="320" r="23" />
      </g>

      {/* Visto bueno. El trazo del color del fondo lo despega del camión y del
          hexágono sin necesidad de recortes. */}
      <path d="M232 374 L288 428 L462 258" stroke={c.hueco} strokeWidth={54}
            strokeLinecap="round" strokeLinejoin="round" />
      <path d="M232 374 L288 428 L462 258" stroke={c.visto} strokeWidth={38}
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
