# Auditoría de ingeniería — Ciclo de vida de la operación

**Sistema:** Preoperational System
**Componente:** motor de datos (PostgreSQL 17) y capa de negocio
**Fecha:** 5 de septiembre de 2026
**Alcance:** desde el síntoma reportado hasta la verificación formal del arreglo
**Estado del sistema:** preproducción. Ninguna empresa cliente estaba operando.

---

## 1. Resumen ejecutivo

Se reportó que un mismo perfil de conductor podía ejecutar varias inspecciones
seguidas, y que tras registrar el regreso de un vehículo tanto la unidad como el
perfil quedaban disponibles otra vez en cuestión de minutos —a veces en el mismo
minuto exacto—, sin que existiera un ciclo controlado de salida, operación y
regreso.

La investigación confirmó el síntoma y encontró que **no era un fallo de
validación, sino una ausencia de invariantes**. La regla «un conductor, una
operación» existía únicamente como una comprobación dentro de un disparador, y
el ciclo de vida no exigía en ningún punto que la operación registrada fuera
físicamente posible.

Se documentan **ocho defectos**, cinco de ellos en el camino crítico. Todos han
sido corregidos en el motor de datos —índices únicos, cerrojos e invariantes de
transición— y no en la interfaz. La corrección se verificó con **78
comprobaciones automáticas en verde** y con una **carrera real entre dos
sesiones simultáneas** que reproduce el fallo antes del arreglo y lo impide
después.

---

## 2. Evidencia (Fase 1)

Toda la evidencia procede de los datos reales del sistema, con precisión de
milisegundos. No se partió de ninguna hipótesis previa.

### 2.1 Un perfil, muchas operaciones

En la ronda 1 del 5 de septiembre:

| Conductor | Inspecciones en la ronda | Vehículos | Ventana |
|---|---|---|---|
| Andrés Felipe Castro | 5 | ZZZ-001, ZZZ-003, ZZZ-005, ZZZ-006 | 00:16:42 → 00:52:00 |
| Carlos Andrés Mendoza | 2 | ZZZ-002, ZZZ-004 | 00:45:31 → 00:47:35 |

Entre el cierre de una operación y la apertura de la siguiente del mismo perfil
llegaron a pasar **19 segundos**.

### 2.2 Operaciones físicamente imposibles

| Inspección | Vehículo | Duración | Recorrido | Velocidad media implícita |
|---|---|---|---|---|
| `9b0f59c8` | ZZZ-001 | 10 s | 101.111 km | 36.399.960 km/h |
| `51dafd0f` | ZZZ-001 | 21 s | 9.000 km | 1.542.857 km/h |
| `bc0e7f56` | ZZZ-007 | 69 s | 91.112 km | 4.753.843 km/h |
| `ae1830c7` | ZZZ-004 | 210 s | 101.111 km | 1.733.331 km/h |
| `9b181727` | ZZZ-003 | 262 s | 101.111 km | 1.389.259 km/h |

Ninguna fue rechazada. El sistema sólo comprobaba que el kilometraje final no
fuera menor que el inicial.

### 2.3 Odómetro que retrocede

| Vehículo | Cierre anterior | Arranque siguiente | Retroceso |
|---|---|---|---|
| ZZZ-001 | 10.000 km | 1.000 km | −9.000 km |
| ZZZ-001 | 11.233 km | 10.000 km | −1.233 km |

Nada relacionaba el kilometraje de una inspección con el de la anterior del
mismo vehículo. El histórico de recorrido de la flota era, por tanto,
inservible para facturar, mantener o auditar.

### 2.4 Borradores huérfanos

Cuatro filas en estado `in_progress`, sin dispositivo asociado, nacidas entre
**0,044 y 0,501 segundos DESPUÉS** de que se enviara su inspección hermana, con
el mismo vehículo, la misma ronda, el mismo conductor y el mismo kilometraje
inicial.

| Borrador | Vehículo | Nace | Hermana enviada | Diferencia |
|---|---|---|---|---|
| `3c1cb740` | ZZZ-004 | 05:47:35.966 | 05:47:35.921 | −0,044 s |
| `5aef7188` | ZZZ-005 | 05:48:32.932 | 05:48:32.621 | −0,310 s |
| `b12c420b` | ZZZ-001 | 05:50:59.200 | 05:50:58.698 | −0,501 s |
| `db46890d` | ZZZ-003 | 05:52:00.544 | 05:52:00.340 | −0,204 s |

### 2.5 Una operación abierta sin prueba de identidad viva

En el momento de la auditoría había una operación abierta (`5163722a`,
ZZZ-003) y **cero** reservas de perfil en `driver_claims`. La reserva que
demuestra que alguien tecleó el PIN se borraba al enviar la inspección y
caducaba a los 45 minutos, con el vehículo todavía en ruta.

---

## 3. Causa raíz (Fase 2)

### 3.1 Los cinco porqués

1. **¿Por qué un conductor sacó varios vehículos?**
   Porque nada lo impedía después de cerrar cada operación, y la regla contra
   dos operaciones *simultáneas* podía saltarse.
2. **¿Por qué podía saltarse?**
   Porque vivía en un disparador que hacía `select … limit 1` y, si no había
   filas, dejaba pasar.
3. **¿Por qué eso no basta?**
   Porque es un «comprobar y luego actuar» **sin cerrojo**. Bajo el nivel de
   aislamiento por defecto (READ COMMITTED), dos transacciones simultáneas leen
   ambas cero filas y ambas escriben.
4. **¿Por qué no lo detuvo nada más?**
   Porque **no existía ningún índice único** que hiciera imposible el resultado
   prohibido. La única defensa era la comprobación que acababa de fallar.
5. **¿Por qué se diseñó así?**
   Porque la regla se pensó como *validación de negocio* (algo que se comprueba)
   y no como *invariante de datos* (algo que el motor no sabe representar). Esa
   es la causa raíz: una decisión de capa, no un descuido de código.

### 3.2 Diagrama de causas

```
                        Un perfil de conductor con
                        varias operaciones y ciclos
                        de segundos
                                  │
    ┌──────────────┬──────────────┼──────────────┬──────────────┐
    │              │              │              │              │
  MOTOR         PROCESO        MEDICIÓN       IDENTIDAD      INTERFAZ
    │              │              │              │              │
 sin índice    el regreso     sin permanencia  el PIN se     autoguardado
 único         libera         mínima           verificaba    con retardo
    │          vehículo y                      en una RPC    que reinsertaba
 comprobación  perfil en el   sin tope de      distinta de   tras el envío
 sin cerrojo   mismo instante plausibilidad    la que abría
    │                                          la operación
 el cerrojo    sin invariante  sin continuidad
 existente era temporal ni     del odómetro
 por VEHÍCULO, de distancia
 nunca por
 CONDUCTOR
```

### 3.3 Máquina de estados que faltaba

La operación tiene tres estados (`none` → `open` → `closed`) pero ninguna de
sus transiciones estaba guardada:

| Transición | Quién la hacía | Qué exigía antes | Qué exige ahora |
|---|---|---|---|
| `none → open` | `submit_inspection` | nada sobre el conductor | reserva de perfil viva + cerrojo + índice único |
| `open → closed` | `register_return` | nada | reserva viva + permanencia mínima + plausibilidad física |
| `rejected → open` | `override_authorization` | nada | prohibido si la operación ya se cerró |
| liberar vehículo | `release_inspection` | nada | prohibido mientras la operación siga abierta |

---

## 4. Defectos, impacto y severidad (Fase 3)

| # | Defecto | Severidad | Impacto |
|---|---|---|---|
| D1 | Sin índice único de operación abierta por conductor; la comprobación del disparador no toma cerrojo | **Crítica** | Dos vehículos en ruta a nombre de la misma persona. Responsabilidad legal indeterminada ante un siniestro. |
| D2 | Sin permanencia mínima ni tope de plausibilidad en el regreso | **Crítica** | Kilometrajes imposibles aceptados como ciertos. Todo informe de recorrido queda invalidado. |
| D3 | Sin continuidad del odómetro entre inspecciones del mismo vehículo | **Crítica** | El odómetro retrocede. Mantenimiento por kilometraje y facturación por recorrido dejan de ser fiables. |
| D4 | `submit_inspection` y `register_return` aceptaban el identificador del conductor sin exigir prueba del PIN | **Crítica** | Cualquiera con la sesión del kiosco podía abrir una operación a nombre de otro conductor o cerrar la de cualquiera. El PIN era sólo un paso de la interfaz. |
| D5 | La reserva de perfil se borraba al enviar la inspección y caducaba en ruta | **Alta** | Se pierde la trazabilidad de quién sacó el vehículo mientras está fuera. |
| D6 | El autoguardado del kiosco reinsertaba un borrador después del envío | **Media** | Filas basura que contaminan conteos e informes. |
| D7 | `submit_inspection` capturaba *cualquier* violación de unicidad y la devolvía como reenvío idempotente, a veces con identificador nulo | **Alta** | Un fallo real se presentaba como éxito. Además habría anulado los índices nuevos. |
| D8 | `override_authorization` reabría operaciones ya cerradas; `release_inspection` liberaba vehículos en ruta; `delete_inspection` dejaba reservas colgando | **Media** | Estados imposibles alcanzables desde el panel de administración. |

### 4.1 Las cuatro preguntas explícitas

**¿Hubo pérdida o corrupción de datos?**
No hubo pérdida. Sí hubo **corrupción semántica**: 5 operaciones con
kilometrajes imposibles y 2 retrocesos de odómetro quedaron registrados como
hechos ciertos. Los datos existen y son legibles; lo que no son es verdad. Los
cuatro borradores huérfanos se archivaron íntegros en
`app.borradores_huerfanos` antes de retirarse: la reparación es reversible.

**¿Se pudo explotar deliberadamente?**
Sí. D4 es explotable sin herramientas especiales: bastaba llamar la API con la
sesión compartida del kiosco y el identificador de cualquier conductor de la
empresa. No se requería el PIN. No hay indicios de que ocurriera —todos los
registros anómalos son coherentes con pruebas manuales del propio equipo— pero
la posibilidad existía.

**¿Afecta a la confianza en el histórico?**
Sí, y de forma acotada. Las operaciones anteriores al 5 de septiembre de 2026
no pueden considerarse fiables en cuanto a kilometraje ni a permanencia. Sí son
fiables en cuanto a resultado del checklist y decisión de autorización, que
siempre se recalcularon en servidor. A partir de las migraciones 0027 y 0028
ningún dato nuevo puede presentar estas anomalías.

**¿Podía llegar a producción sin detectarse?**
Sí, y ése es el hallazgo más incómodo. La suite de reglas existente pasaba
íntegra: probaba que la regla existía, no que fuera indestructible. El fallo
sólo aparece con dos sesiones simultáneas o con datos físicamente imposibles, y
ninguna prueba de una sola sesión podía encontrarlo. Se ha corregido añadiendo
una suite de concurrencia real.

---

## 5. Corrección (Fase 4)

El arreglo está en el **motor de datos**, no en la interfaz. Tres capas, de
dentro hacia fuera:

### Capa 1 — La garantía dura: índices únicos parciales

```sql
create unique index uq_operacion_abierta_por_conductor
  on public.inspections(driver_id)
  where operation_status = 'open' and driver_id is not null;

create unique index uq_operacion_abierta_por_vehiculo
  on public.inspections(vehicle_id)
  where operation_status = 'open';
```

A partir de aquí, «dos operaciones abiertas del mismo conductor» es un estado
que la base de datos **no sabe representar**. Ninguna vía de escritura,
concurrencia ni SQL directo puede producirlo.

### Capa 2 — Cerrojos de aviso por conductor

El disparador sigue existiendo para dar un mensaje legible en castellano, pero
ahora toma `pg_advisory_xact_lock` sobre el conductor **antes** de comprobar.
Las transacciones que compiten por el mismo perfil se ponen en fila en vez de
leer las dos «no hay nada abierto». El orden de cerrojos en todo el sistema es
**conductor y después vehículo**, para que no existan abrazos mortales.

### Capa 3 — Invariantes del ciclo

Se distingue a propósito **política** de **física**:

| Invariante | Naturaleza | Configurable | Valor por defecto |
|---|---|---|---|
| Permanencia mínima entre salida y regreso | Política de empresa | `organizations.min_operacion_segundos` | 300 s |
| Distancia máxima por operación | Plausibilidad | `organizations.max_km_operacion` | 2.000 km |
| Velocidad media máxima implícita | Plausibilidad | `organizations.max_kmh_operacion` | 120 km/h |
| El odómetro no retrocede | Física | no negociable | — |
| El kilometraje final ≥ inicial | Física | no negociable | — |

La permanencia mínima es la que mata la «reutilización inmediata»: un vehículo
que salió hace veintiún segundos no puede haber vuelto.

### Prueba de identidad

`claim_driver` ahora deja constancia **siempre** que el PIN es correcto,
incluido el caso en que el conductor ya tiene un vehículo en ruta —antes salía
sin registrar nada—. Esa reserva dura un turno largo (12 h), no se suelta
mientras la operación siga abierta, y es lo que autoriza tanto abrir como
cerrar. `submit_inspection`, `save_inspection_draft` y `register_return` exigen
el identificador del dispositivo y verifican la reserva.

Se **retiraron** las firmas antiguas de las tres funciones: dejarlas vivas
habría sido dejar la puerta abierta al lado de la puerta nueva.

### La salida supervisada

Un control sin salida legítima acaba desactivado. `force_close_operation`
permite a administración cerrar una operación que no cumple la permanencia
mínima —un movimiento de patio de dos minutos, un conductor que se marchó sin
registrar el regreso— con **motivo obligatorio** y rastro en auditoría. No
levanta la física: el odómetro sigue sin poder retroceder.

### Barrido del mismo patrón

Se buscó el patrón en el resto del sistema y apareció en tres funciones de
administración, corregidas en la migración 0028:

- `override_authorization` reabría operaciones ya cerradas y levantaba
  bloqueos de vehículo que no había puesto ella.
- `release_inspection` declaraba disponible un vehículo con la operación
  abierta.
- `delete_inspection` borraba la operación pero dejaba viva la reserva del
  perfil.

---

## 6. Verificación formal (Fase 5)

### 6.1 Suite completa de regresión

| Suite | Comprobaciones | Resultado |
|---|---|---|
| `rules.test.sql` — reglas de negocio | 18 | ✅ todas |
| `consola.test.sql` — consola de plataforma | 24 | ✅ todas |
| `ciclo_operacion.test.sql` — ciclo de operación (nueva) | 15 | ✅ todas |
| `aislamiento.test.sql` — RLS entre empresas | 14 | ✅ todas |
| `regreso.test.sql` — regreso desde cualquier equipo | 7 | ✅ todas |
| **Total** | **78** | **✅** |

### 6.2 Las pruebas fallan sin el arreglo

Una prueba que sólo pasa no demuestra nada si no se sabe que podía fallar. Dos
comprobaciones lo establecen:

- `ciclo_operacion.test.sql` nº 1 desactiva el disparador —simulando que la
  comprobación no vio a la otra transacción— y confirma que es el **índice
  único** quien rechaza el estado prohibido.
- `ciclo_operacion.test.sql` nº 2 retira el índice y reproduce el sistema tal
  como estaba: el mismo conductor termina con **dos** operaciones abiertas.

### 6.3 Carrera real entre dos sesiones (`concurrencia.test.sql`)

Dos conexiones independientes intentan sacar dos vehículos distintos con el
mismo perfil, solapadas en el tiempo.

**Sin el arreglo** (índice retirado, disparador 0019 restaurado):

| | |
|---|---|
| Sesión A | ACEPTADA |
| Sesión B | ACEPTADA |
| Estado de B mientras A no confirmaba | `Client / ClientRead` — **no esperó** |
| Vehículos en ruta del mismo conductor | **2** (QA-CARRERA-1 + QA-CARRERA-2) |

**Con el arreglo:**

| | |
|---|---|
| Sesión A | `authorized` |
| Sesión B | RECHAZADA: «Este conductor tiene el vehículo QA-CARRERA-1 en ruta desde las 01:40…» |
| Estado de B mientras A no confirmaba | `Lock / advisory` — **esperó al cerrojo de A** |
| Vehículos en ruta del mismo conductor | **1** |

El banco de pruebas se retira íntegro al terminar: rol temporal eliminado,
extensión `dblink` desinstalada, vehículos y conductor de prueba borrados.

### 6.4 Casos límite comprobados

- Regreso registrado en el **mismo segundo** que la salida → rechazado,
  indicando cuánto falta.
- 101.111 km en 210 segundos → rechazado por implausible.
- Inspección que arranca por debajo del odómetro del cierre anterior →
  rechazada, citando la cifra.
- Regreso **sin** haber tecleado el PIN → rechazado.
- Regreso con la reserva de **otro dispositivo** → rechazado.
- Autoguardado que llega **después** del envío → no escribe nada.
- Liberar un vehículo en ruta desde el panel → rechazado.
- Soltar la reserva de un conductor en ruta → rechazado.
- Reabrir con override una operación ya cerrada → rechazado.
- Cierre supervisado por administración → permitido, con motivo en auditoría.

---

## 7. Reparación de los datos existentes

- Los **cuatro borradores huérfanos** se copiaron íntegros a
  `app.borradores_huerfanos` y luego se retiraron de `inspections`. Nada se
  destruyó: la reparación es reversible fila a fila.
- El criterio de identificación se **midió**, no se supuso: coincidencia exacta
  de vehículo, ronda y conductor dentro de una ventana de cinco segundos
  alrededor del envío de la hermana. Un borrador legítimo puede convivir con
  una inspección cerrada del mismo vehículo tras un regreso limpio, así que
  «tener una hermana» no habría bastado como criterio.
- Los registros con kilometraje imposible **se conservan**. Corregirlos sería
  inventar datos. Quedan como parte del histórico anterior al arreglo, con la
  salvedad documentada en el apartado 4.1.

---

## 8. Recomendaciones

1. **Ajustar `min_operacion_segundos` por empresa** antes de dar de alta a cada
   cliente. El valor por defecto de 300 s sirve para flota de carretera; una
   operación de patio necesitará menos.
2. **Revisar los registros anteriores al 5 de septiembre de 2026** antes de usar
   el histórico de kilometraje para facturar o para programar mantenimiento.
3. **Ejecutar `concurrencia.test.sql` en cada cambio** que toque
   `submit_inspection`, `register_return` o el disparador de operación. Es la
   única prueba que puede detectar una regresión de este tipo.
4. **Mantener la regla de capa**: toda regla que describa un estado que el
   sistema no debe alcanzar necesita un índice o una restricción, no sólo una
   comprobación. Una comprobación avisa; un invariante impide.

---

## 9. Trazabilidad

| Artefacto | Ruta |
|---|---|
| Corrección del ciclo de operación | `supabase/migrations/0027_ciclo_de_vida_de_operacion.sql` |
| Barrido del mismo patrón | `supabase/migrations/0028_barrido_del_mismo_patron.sql` |
| Suite del ciclo de operación | `supabase/tests/ciclo_operacion.test.sql` |
| Suite de concurrencia real | `supabase/tests/concurrencia.test.sql` |
| Archivo de borradores retirados | tabla `app.borradores_huerfanos` |
| Rastro de cierres supervisados | `audit_logs`, acción `operation_force_closed` |
