// Compresión de imágenes en el navegador ANTES de subirlas a Storage.
//
// Por qué existe: la cámara de un celular entrega JPEG de 3–8 MB. Subir eso tal
// cual agota el almacenamiento y, sobre todo, el ancho de banda (cada vez que un
// administrador abre la galería se descarga el original completo). Reescalar y
// recomprimir reduce el peso entre 10x y 20x sin perder el detalle que importa
// en una evidencia de inspección (una luz fundida, una llanta lisa, una fuga).
//
// Se hace en el cliente a propósito: así el archivo pesado nunca viaja por la
// red. Si el navegador no puede procesar la imagen, se sube el original: nunca
// se pierde la evidencia por un fallo de compresión.

export type CompressOptions = {
  /** Lado mayor máximo en píxeles. */
  maxDim: number;
  /** Calidad JPEG (0–1). */
  quality: number;
};

/** Evidencia fotográfica: debe permitir ampliar y distinguir el detalle. */
export const EVIDENCE_PRESET: CompressOptions = { maxDim: 1600, quality: 0.72 };

/** Foto de perfil del conductor: sólo se muestra como avatar. */
export const AVATAR_PRESET: CompressOptions = { maxDim: 512, quality: 0.8 };

/**
 * Reescala y recomprime una imagen a JPEG.
 * Devuelve siempre un File utilizable: ante cualquier error, el original.
 */
export async function compressImage(file: File, opts: CompressOptions): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  // Los GIF/SVG pierden sentido al rasterizarse; se dejan intactos.
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, opts.maxDim);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    if ("close" in bitmap) bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", opts.quality),
    );
    if (!blob) return file;

    // Si comprimir no ayudó (imagen ya pequeña u optimizada), conservar el original.
    if (blob.size >= file.size) return file;

    return new File([blob], toJpegName(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

/**
 * Decodifica el archivo respetando la orientación EXIF (si no, las fotos
 * tomadas en vertical se suben giradas).
 */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Safari antiguo no admite imageOrientation: se reintenta sin la opción.
      try {
        return await createImageBitmap(file);
      } catch {
        /* cae al método con <img> */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Escala manteniendo la proporción; nunca amplía una imagen pequeña. */
function fitWithin(w: number, h: number, maxDim: number) {
  const factor = Math.min(1, maxDim / Math.max(w, h));
  return { width: Math.round(w * factor), height: Math.round(h * factor) };
}

function toJpegName(name: string) {
  return name.replace(/\.[^.]+$/, "") + ".jpg";
}
