# Respaldos y recuperación ante desastres

## Lo primero: la situación real

**El plan gratuito de Supabase NO hace respaldos automáticos.** La documentación
oficial lo dice sin rodeos: los respaldos diarios existen a partir del plan Pro,
y para el plan gratuito *recomiendan exportar los datos con la CLI y mantener
copias fuera del servicio*.

Traducido a esta operación: **hoy, si la base de datos se pierde, se pierde
todo** — inspecciones, novedades, evidencias y auditoría. Y en un sistema cuyo
valor es poder demostrar qué se revisó y cuándo, perder el historial no es un
inconveniente técnico: es perder la prueba ante un siniestro.

Además, hay algo que sorprende a mucha gente y conviene tener claro:

> Los respaldos de base de datos **no incluyen los archivos de Storage**. La base
> sólo guarda la ruta de cada foto. Restaurar un respaldo **no devuelve las
> fotos** que se hayan borrado.

Por eso este plan cubre **dos cosas separadas**: la base de datos y las fotos.

---

## Qué hay que proteger

| Qué | Dónde vive | Si se pierde |
|---|---|---|
| Inspecciones, novedades, rondas, auditoría | PostgreSQL | Se pierde la prueba de qué se revisó |
| Fotos de evidencia y de conductores | Storage (buckets `evidence`, `driver-photos`) | Se pierde la prueba visual del hallazgo |
| Usuarios y contraseñas | `auth.users` | Nadie puede entrar |
| Definición del checklist | PostgreSQL | Se pierde la configuración de criticidad |

---

## Objetivos (qué prometer a un cliente)

| Métrica | Con respaldo manual diario | Con plan Pro | Con Pro + PITR |
|---|---|---|---|
| **RPO** (cuántos datos se pierden) | hasta 24 h | hasta 24 h | ~2 minutos |
| **RTO** (cuánto tarda volver) | 1–2 h | ~30 min | ~30 min |

Antes de firmar con una empresa, **el plan Pro deja de ser opcional**. Ofrecer
un sistema de seguridad sin respaldos es una promesa que no se puede cumplir.

---

## Procedimiento mientras se esté en plan gratuito

### 1. Respaldo (hacerlo a diario)

```bash
# Requiere la CLI de Supabase: https://supabase.com/docs/guides/local-development
export SUPABASE_DB_URL="postgresql://postgres:CONTRASEÑA@db.vkduxheifqmomtazolku.supabase.co:5432/postgres"

./scripts/backup.sh
```

Genera, en `backups/AAAA-MM-DD/`:

- `datos.sql` — todos los datos de negocio
- `esquema.sql` — estructura, funciones y políticas
- `roles.sql` — usuarios y permisos

**Guarda esa carpeta FUERA de Supabase** (disco externo, Drive, S3). Un respaldo
que vive en el mismo sitio que el original no es un respaldo.

### 2. Las fotos, aparte

Los archivos de Storage no salen en el volcado de la base. Descárgalos con la
CLI o desde el panel:

```bash
supabase storage download --recursive ss:///evidence      ./backups/AAAA-MM-DD/fotos/evidence
supabase storage download --recursive ss:///driver-photos ./backups/AAAA-MM-DD/fotos/driver-photos
```

### 3. Restauración

```bash
psql "$SUPABASE_DB_URL" -f backups/AAAA-MM-DD/roles.sql
psql "$SUPABASE_DB_URL" -f backups/AAAA-MM-DD/esquema.sql
psql "$SUPABASE_DB_URL" -f backups/AAAA-MM-DD/datos.sql
```

Después, vuelve a subir las fotos a sus buckets y ejecuta la suite de reglas
para comprobar que el sistema quedó sano:

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/rules.test.sql
```

---

## Una regla que no se negocia

**Un respaldo que nunca se ha restaurado no es un respaldo: es una suposición.**

Haz una restauración de prueba **una vez al mes** sobre un proyecto Supabase
vacío (no sobre producción). Es la única forma de saber que el procedimiento
funciona antes de necesitarlo de verdad.

---

## Cuando pases a plan Pro

1. Los respaldos diarios se activan solos (7 días de retención).
2. Considera **PITR** si el cliente no tolera perder un día de inspecciones.
3. Aun así, **sigue guardando una copia mensual fuera de Supabase**: si la
   cuenta se suspende o se borra el proyecto por error, los respaldos internos
   se borran con él. La documentación advierte que borrar un proyecto elimina
   permanentemente también sus respaldos.
