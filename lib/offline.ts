// Persistencia local para trabajar sin señal.
//
// POR QUÉ EXISTE
// Un patio de flota suele tener mala cobertura. Sin esto, un conductor que
// pierde la señal a mitad del checklist —o que bloquea el teléfono— pierde 5
// minutos de trabajo y, peor, puede terminar saliendo sin inspeccionar.
//
// QUÉ GARANTIZA Y QUÉ NO
// - Guarda el borrador completo (respuestas, novedades y FOTOS) en el propio
//   dispositivo, de forma que sobreviva a un cierre de la aplicación.
// - Si al enviar no hay conexión, deja la inspección en una cola y la reenvía
//   cuando vuelve la señal.
// - NO decide el resultado: el veredicto (autorizado o no) lo sigue calculando
//   PostgreSQL cuando la inspección llega. Mientras esté en cola, la inspección
//   NO existe para la operación, y así se le dice al conductor.
//
// SEGURIDAD DEL REENVÍO
// Cada inspección lleva una clave de idempotencia generada antes del primer
// intento. Reenviar la misma inspección diez veces produce UN solo registro:
// esa garantía ya está en `submit_inspection`, y es lo que hace seguro el modo
// sin conexión. Sin ella, la cola podría duplicar inspecciones.

const DB_NAME = "preop-offline";
const DB_VERSION = 1;
const STORE_DRAFT = "borrador";   // Un único borrador en curso.
const STORE_QUEUE = "cola";       // Inspecciones pendientes de enviar.

/** Inspección lista para enviar, con sus fotos como binarios. */
export type PendingInspection = {
  /** Clave de idempotencia: identifica la inspección aunque se reenvíe. */
  idempotencyKey: string;
  vehicleId: string;
  driverId: string;
  /**
   * Dispositivo que registró la inspección. Viaja con ella porque el servidor
   * exige la reserva de perfil de ESE equipo para abrir la operación: sin este
   * dato, una inspección que esperó a que volviera la señal se rechazaría por
   * identidad no verificada.
   */
  deviceId?: string;
  vehiclePlate: string;
  driverName: string;
  answers: unknown[];
  kmInicial: number | null;
  fuelIn: string;
  obs: string;
  /** Fotos pendientes de subir: ruta destino + contenido. */
  photos: { path: string; blob: Blob }[];
  /** Momento en que el conductor pulsó enviar (no cuando se sincroniza). */
  createdAt: number;
  intentos: number;
  ultimoError?: string;
};

export type DraftState = {
  step: string;
  driver: { id: string; name: string } | null;
  vehicle: { id: string; plate: string } | null;
  catIndex: number;
  answers: Record<string, string>;
  kmInicial: string;
  fuelIn: string;
  obs: string;
  /**
   * Novedades ya registradas, con la ruta de sus fotos en el almacén.
   *
   * Antes no se guardaban: si el teléfono se apagaba a mitad del checklist, el
   * conductor recuperaba las respuestas pero perdía las novedades y las fotos,
   * que es justo lo que más cuesta volver a hacer de pie en el patio.
   *
   * `preview` es una URL de objeto del navegador y muere al recargar; se
   * conserva el campo por compatibilidad de tipo, pero al restaurar se vacía.
   */
  issues: Record<string, { note: string; evidence: { path: string; preview: string }[] }>;
  roundId: string | null;
  savedAt: number;
};

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DRAFT)) db.createObjectStore(STORE_DRAFT);
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "idempotencyKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, modo);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

/** IndexedDB puede no existir (navegador antiguo, modo privado restringido). */
export function offlineDisponible(): boolean {
  return typeof indexedDB !== "undefined";
}

// ---------------------------------------------------------------------------
// Borrador en curso
// ---------------------------------------------------------------------------

export async function guardarBorrador(d: DraftState): Promise<void> {
  if (!offlineDisponible()) return;
  try { await tx(STORE_DRAFT, "readwrite", (s) => s.put(d, "actual")); } catch { /* no bloquear al conductor */ }
}

export async function leerBorrador(): Promise<DraftState | null> {
  if (!offlineDisponible()) return null;
  try { return (await tx<DraftState>(STORE_DRAFT, "readonly", (s) => s.get("actual"))) ?? null; }
  catch { return null; }
}

export async function borrarBorrador(): Promise<void> {
  if (!offlineDisponible()) return;
  try { await tx(STORE_DRAFT, "readwrite", (s) => s.delete("actual")); } catch { /* ignorar */ }
}

// ---------------------------------------------------------------------------
// Cola de envío
// ---------------------------------------------------------------------------

export async function encolar(p: PendingInspection): Promise<void> {
  await tx(STORE_QUEUE, "readwrite", (s) => s.put(p));
}

export async function leerCola(): Promise<PendingInspection[]> {
  if (!offlineDisponible()) return [];
  try {
    const items = await tx<PendingInspection[]>(STORE_QUEUE, "readonly", (s) => s.getAll());
    return (items ?? []).sort((a, b) => a.createdAt - b.createdAt);
  } catch { return []; }
}

export async function desencolar(idempotencyKey: string): Promise<void> {
  if (!offlineDisponible()) return;
  try { await tx(STORE_QUEUE, "readwrite", (s) => s.delete(idempotencyKey)); } catch { /* ignorar */ }
}

export async function marcarIntento(p: PendingInspection, error: string): Promise<void> {
  if (!offlineDisponible()) return;
  try {
    await tx(STORE_QUEUE, "readwrite", (s) =>
      s.put({ ...p, intentos: p.intentos + 1, ultimoError: error }));
  } catch { /* ignorar */ }
}

/**
 * ¿Este error se debe a falta de conexión?
 * Distinguirlo importa: un fallo de red se reintenta, pero un rechazo del
 * servidor (por ejemplo "el vehículo está bloqueado") NO debe reintentarse en
 * bucle, porque la respuesta va a ser siempre la misma.
 */
export function esErrorDeRed(e: unknown): boolean {
  // Se compara contra `false` a propósito. En algunos webviews `onLine` llega
  // como undefined; con `!navigator.onLine` cualquier rechazo del servidor se
  // habría tomado por fallo de red y la cola habría reintentado en bucle algo
  // que nunca iba a aceptarse.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String((e as { message?: string })?.message ?? e ?? "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("load failed") ||
    msg.includes("timeout") ||
    msg.includes("err_internet")
  );
}
