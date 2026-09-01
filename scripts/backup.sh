#!/usr/bin/env bash
# Respaldo completo de la base de datos.
#
# El plan gratuito de Supabase no hace respaldos automáticos, así que este
# script es la única red de seguridad mientras no se pase a plan Pro.
#
# Uso:
#   export SUPABASE_DB_URL="postgresql://postgres:CLAVE@db.<ref>.supabase.co:5432/postgres"
#   ./scripts/backup.sh [carpeta-destino]
#
# IMPORTANTE: las fotos de Storage NO salen aquí. Un volcado de la base sólo
# guarda la ruta de cada archivo, no el archivo. Ver docs/BACKUPS.md.

set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: falta la variable SUPABASE_DB_URL." >&2
  echo "       Se obtiene en el panel de Supabase → Project Settings → Database." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: no se encontró pg_dump. Instala las herramientas de PostgreSQL." >&2
  exit 1
fi

FECHA="$(date +%F)"
DESTINO="${1:-backups}/${FECHA}"
mkdir -p "$DESTINO"

echo "→ Respaldando en $DESTINO"

# Roles primero: sin ellos, restaurar el esquema falla por permisos.
echo "  · roles y permisos"
pg_dumpall --roles-only --dbname "$SUPABASE_DB_URL" > "$DESTINO/roles.sql" 2>/dev/null \
  || echo "    (omitido: requiere permisos de superusuario)"

echo "  · estructura, funciones y políticas"
pg_dump --schema-only --no-owner --no-privileges \
  --schema=public --schema=app \
  "$SUPABASE_DB_URL" > "$DESTINO/esquema.sql"

echo "  · datos de negocio"
pg_dump --data-only --no-owner --no-privileges \
  --schema=public \
  "$SUPABASE_DB_URL" > "$DESTINO/datos.sql"

# La tabla de usuarios vive en el esquema `auth`, gestionado por Supabase.
echo "  · usuarios de acceso"
pg_dump --data-only --no-owner --no-privileges \
  --table=auth.users --table=auth.identities \
  "$SUPABASE_DB_URL" > "$DESTINO/usuarios.sql" 2>/dev/null \
  || echo "    (omitido: sin acceso al esquema auth)"

# Resumen para poder verificar de un vistazo que el respaldo trae algo.
{
  echo "Respaldo del $FECHA"
  echo "Generado: $(date -Iseconds)"
  echo
  for f in "$DESTINO"/*.sql; do
    printf '%-16s %s\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
  done
} > "$DESTINO/RESUMEN.txt"

cat "$DESTINO/RESUMEN.txt"

echo
echo "✓ Listo."
echo
echo "FALTAN LAS FOTOS. Los respaldos de base de datos no incluyen Storage:"
echo "  supabase storage download --recursive ss:///evidence      $DESTINO/fotos/evidence"
echo "  supabase storage download --recursive ss:///driver-photos $DESTINO/fotos/driver-photos"
echo
echo "Y copia $DESTINO a un lugar FUERA de Supabase."
