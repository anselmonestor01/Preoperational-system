// Marca de Preoperational System.
//
// CÓMO SUSTITUIR ESTE DIBUJO POR EL ARCHIVO ORIGINAL
// Este SVG es una reconstrucción hecha a partir de una imagen del logo. Para
// usar el archivo real, basta con:
//   1. copiar el .svg original a `public/marca.svg`, y
//   2. reemplazar el <svg> de abajo por:
//        <img src="/marca.svg" width={size} height={size} alt="Preoperational System" />
// El resto del sistema no cambia: todas las pantallas usan este componente.
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
      {/* Hexágono */}
      <path
        d="M256 60 L424 158 L424 354 L256 452 L88 354 L88 158 Z"
        stroke={c.trazo}
        strokeWidth={27}
        strokeLinejoin="round"
      />

      <g fill={c.trazo}>
        {/* Furgón: cara lateral con el techo en perspectiva */}
        <path d="M138 186 L214 166 L214 330 L138 330 Z" />
        {/* Cabina: techo inclinado y frente redondeado */}
        <path d="M222 170 L318 170 Q352 170 358 198 L366 246 L366 330 L222 330 Z" />
        {/* Espejo retrovisor */}
        <path d="M366 204 L386 200 L386 232 L366 228 Z" />
      </g>

      <g fill={c.hueco}>
        {/* Separación entre furgón y cabina */}
        <rect x="210" y="160" width="12" height="176" />
        {/* Parabrisas */}
        <path d="M240 196 L330 196 Q344 196 348 210 L354 244 Q356 254 344 254 L240 254 Q230 254 230 244 L230 206 Q230 196 240 196 Z" />
        {/* Rejilla */}
        <rect x="252" y="272" width="98" height="12" rx="6" />
        <rect x="252" y="292" width="98" height="12" rx="6" />
        <rect x="252" y="312" width="76" height="12" rx="6" />
        {/* Pasos de rueda */}
        <circle cx="238" cy="332" r="33" />
        <circle cx="344" cy="332" r="33" />
      </g>

      <g fill={c.trazo}>
        <circle cx="238" cy="332" r="24" />
        <circle cx="344" cy="332" r="24" />
      </g>

      {/* Visto bueno: se afila hacia la punta, como el original. La copia del
          color del fondo lo despega del camión y del hexágono. */}
      <path d="M206 380 L284 452 L492 240 L462 218 L286 396 L238 340 Z"
            fill={c.hueco} stroke={c.hueco} strokeWidth={26} strokeLinejoin="round" />
      <path d="M214 386 L284 444 L478 250 L458 232 L286 388 L242 348 Z"
            fill={c.visto} stroke={c.visto} strokeWidth={3} strokeLinejoin="round" />
    </svg>
  );
}
