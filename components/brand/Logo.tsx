// Marca de Preoperational System.
//
// El trazado viene del archivo vectorial original (`public/marca.svg`), copiado
// literalmente: no es un redibujo. Se pinta en línea en vez de con <img> por una
// razón concreta: el color del original (#061427) es casi el mismo azul oscuro
// de la barra lateral del panel, así que ahí el logo desaparecía. Teniéndolo en
// línea se invierte la paleta con la propiedad `tone` sin duplicar el archivo.
//
// Si el logo cambia, se reemplaza `public/marca.svg` y se vuelven a copiar aquí
// los dos atributos `d`.

/**
 * Lienzo recortado al dibujo.
 *
 * El archivo original declara `viewBox="0 0 1254 1254"`, pero el dibujo sólo
 * ocupa de 264 a 1075 en horizontal y de 152 a 1004 en vertical: un 65% del
 * lienzo. Ese aire sobrante hacía que la marca se viera pequeña y despegada del
 * texto, porque a 44 px de caja el dibujo medía 28 px reales.
 *
 * Aquí se recorta a un cuadrado centrado en el dibujo (886 de lado, con el mismo
 * margen por los cuatro costados), de modo que la marca llena su caja. El
 * archivo de `public/marca.svg` se conserva tal cual llegó.
 */
const VIEWBOX = "226 135 886 886";

type Tone = "brand" | "light";

/** Colores del archivo original. */
const ORIGINAL = { cuerpo: "#061427", visto: "#174A7B" };

const PALETA: Record<Tone, { cuerpo: string; visto: string }> = {
  // Sobre fondo claro: exactamente los colores del original.
  brand: ORIGINAL,
  // Sobre la barra lateral azul oscuro: el cuerpo se invierte a blanco y el
  // visto se aclara, porque el azul original no contrasta contra el fondo.
  light: { cuerpo: "#FFFFFF", visto: "#5C9BEE" },
};

const D_CUERPO =
  "M 798.0,725.0 L 795.0,739.0 L 790.0,746.0 L 782.0,750.0 L 679.0,753.0 L 668.0,745.0 L 662.0,732.0 L 663.0,728.0 Z M 534.0,712.0 L 525.0,715.0 L 517.0,728.0 L 513.0,746.0 L 512.0,777.0 L 515.0,794.0 L 523.0,812.0 L 532.0,818.0 L 544.0,818.0 L 552.0,815.0 L 559.0,809.0 L 563.0,801.0 L 564.0,792.0 L 558.0,783.0 L 556.0,747.0 L 552.0,727.0 L 545.0,717.0 Z M 393.0,709.0 L 392.0,745.0 L 397.0,747.0 L 398.0,761.0 L 405.0,775.0 L 409.0,777.0 L 448.0,777.0 L 453.0,772.0 L 457.0,759.0 L 495.0,767.0 L 495.0,723.0 Z M 585.0,703.0 L 590.0,702.0 L 634.0,719.0 L 639.0,727.0 L 646.0,751.0 L 628.0,750.0 L 599.0,743.0 L 591.0,732.0 Z M 528.0,687.0 L 520.0,688.0 L 513.0,694.0 L 506.0,711.0 L 503.0,741.0 L 505.0,769.0 L 508.0,773.0 L 509.0,742.0 L 514.0,719.0 L 524.0,703.0 L 536.0,697.0 L 541.0,698.0 L 533.0,689.0 Z M 805.0,687.0 L 803.0,701.0 L 798.0,706.0 L 739.0,709.0 L 665.0,710.0 L 658.0,706.0 L 653.0,691.0 L 654.0,688.0 L 797.0,685.0 Z M 643.0,648.0 L 658.0,646.0 L 808.0,646.0 L 811.0,650.0 L 809.0,664.0 L 803.0,669.0 L 652.0,670.0 L 646.0,663.0 Z M 525.0,636.0 L 534.0,641.0 L 535.0,652.0 L 524.0,650.0 L 523.0,638.0 Z M 833.0,510.0 L 842.0,516.0 L 841.0,552.0 L 832.0,514.0 Z M 575.0,487.0 L 581.0,480.0 L 593.0,479.0 L 813.0,491.0 L 819.0,495.0 L 822.0,501.0 L 835.0,566.0 L 836.0,581.0 L 826.0,590.0 L 607.0,589.0 L 592.0,581.0 L 586.0,571.0 Z M 538.0,415.0 L 531.0,427.0 L 527.0,468.0 L 548.0,459.0 L 574.0,452.0 L 525.0,480.0 L 523.0,493.0 L 553.0,483.0 L 559.0,484.0 L 562.0,489.0 L 567.0,585.0 L 555.0,583.0 L 542.0,575.0 L 542.0,504.0 L 540.0,502.0 L 520.0,508.0 L 518.0,569.0 L 535.0,575.0 L 545.0,585.0 L 565.0,596.0 L 566.0,604.0 L 560.0,609.0 L 552.0,609.0 L 545.0,604.0 L 540.0,593.0 L 517.0,585.0 L 516.0,670.0 L 531.0,672.0 L 541.0,676.0 L 552.0,687.0 L 562.0,707.0 L 570.0,745.0 L 572.0,783.0 L 584.0,791.0 L 581.0,804.0 L 574.0,817.0 L 604.0,817.0 L 609.0,815.0 L 617.0,804.0 L 620.0,791.0 L 813.0,782.0 L 848.0,758.0 L 852.0,750.0 L 852.0,729.0 L 843.0,737.0 L 813.0,747.0 L 811.0,743.0 L 818.0,718.0 L 823.0,713.0 L 850.0,699.0 L 845.0,687.0 L 849.0,680.0 L 849.0,658.0 L 844.0,593.0 L 864.0,574.0 L 861.0,519.0 L 857.0,513.0 L 830.0,500.0 L 824.0,481.0 L 817.0,471.0 L 808.0,467.0 L 794.0,439.0 L 783.0,430.0 L 771.0,426.0 L 551.0,411.0 Z M 475.0,376.0 L 369.0,466.0 L 369.0,694.0 L 475.0,706.0 Z M 742.0,391.0 L 489.0,372.0 L 489.0,707.0 L 498.0,708.0 L 499.0,699.0 L 507.0,681.0 L 501.0,670.0 L 505.0,513.0 L 512.0,477.0 L 517.0,426.0 L 524.0,409.0 L 532.0,402.0 L 542.0,398.0 L 565.0,396.0 L 744.0,410.0 Z M 620.0,152.0 L 605.0,157.0 L 282.0,358.0 L 270.0,372.0 L 264.0,392.0 L 264.0,762.0 L 271.0,781.0 L 287.0,796.0 L 615.0,997.0 L 630.0,1003.0 L 644.0,1004.0 L 657.0,1001.0 L 675.0,992.0 L 970.0,822.0 L 979.0,813.0 L 986.0,798.0 L 987.0,761.0 L 953.0,783.0 L 945.0,791.0 L 845.0,852.0 L 677.0,983.0 L 639.0,966.0 L 311.0,765.0 L 305.0,759.0 L 302.0,753.0 L 302.0,398.0 L 304.0,393.0 L 312.0,385.0 L 620.0,193.0 L 631.0,192.0 L 894.0,354.0 L 949.0,391.0 L 952.0,398.0 L 953.0,667.0 L 992.0,642.0 L 991.0,391.0 L 984.0,370.0 L 967.0,353.0 L 653.0,159.0 L 635.0,152.0 Z";

const D_VISTO =
  "M 1075.0,633.0 L 1073.0,632.0 L 1043.0,652.0 L 1040.0,652.0 L 990.0,685.0 L 987.0,685.0 L 984.0,689.0 L 957.0,704.0 L 951.0,710.0 L 932.0,720.0 L 926.0,726.0 L 918.0,729.0 L 918.0,731.0 L 915.0,731.0 L 915.0,733.0 L 912.0,733.0 L 912.0,735.0 L 909.0,735.0 L 898.0,744.0 L 895.0,744.0 L 895.0,746.0 L 892.0,746.0 L 892.0,748.0 L 889.0,748.0 L 889.0,750.0 L 886.0,750.0 L 886.0,752.0 L 883.0,752.0 L 883.0,754.0 L 880.0,754.0 L 880.0,756.0 L 877.0,756.0 L 877.0,758.0 L 874.0,758.0 L 677.0,893.0 L 669.0,890.0 L 630.0,856.0 L 584.0,855.0 L 582.0,853.0 L 557.0,852.0 L 673.0,948.0 L 679.0,947.0 Z";

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
      viewBox={VIEWBOX}
      className={className}
      role="img"
      aria-label="Preoperational System"
    >
      <path d={D_CUERPO} fill={c.cuerpo} fillRule="evenodd" clipRule="evenodd" />
      <path d={D_VISTO} fill={c.visto} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}
