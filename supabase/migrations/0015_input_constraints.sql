-- 0015 — Límites y formato de los datos, aplicados en la BASE DE DATOS.
--
-- Por qué aquí y no sólo en el formulario: quien quiera atacar el sistema no va
-- a usar el formulario. Va a llamar la API directamente. La validación del
-- navegador es comodidad para el usuario; ESTA es la que de verdad protege.
--
-- Qué previene:
--  · Cargas enormes: sin un tope, alguien puede enviar millones de caracteres
--    en un campo de texto y llenar el almacenamiento o degradar el servicio.
--  · Datos imposibles: kilometrajes negativos o de mil millones, placas vacías.
--  · Basura silenciosa: nombres en blanco que dejan registros sin identificar.
--
-- Nota sobre inyección: el sistema usa consultas parametrizadas (nunca arma SQL
-- concatenando texto) y React escapa todo lo que muestra, así que ni SQL ni
-- scripts se ejecutan. Estos límites cubren el otro frente: el volumen.
--
-- Los mismos números están en `lib/validation.ts` para que el formulario avise
-- antes de enviar. La base de datos es la autoridad; el cliente, la cortesía.

-- ---------------------------------------------------------------- vehículos
alter table public.vehicles
  drop constraint if exists chk_vehicles_plate,
  add constraint chk_vehicles_plate
    check (char_length(btrim(plate)) between 3 and 15),
  drop constraint if exists chk_vehicles_reference,
  add constraint chk_vehicles_reference
    check (reference is null or char_length(reference) <= 80);

-- --------------------------------------------------------------- conductores
-- Los campos opcionales guardan cadena vacía (no NULL) cuando no se llenan, así
-- que la restricción trata '' como "sin dato". Sin esa salvedad no se podría
-- dar de alta un conductor sin licencia registrada.
alter table public.drivers
  drop constraint if exists chk_drivers_name,
  add constraint chk_drivers_name
    check (char_length(btrim(full_name)) between 3 and 80),
  drop constraint if exists chk_drivers_license,
  add constraint chk_drivers_license
    check (license is null or btrim(license) = ''
           or char_length(btrim(license)) between 3 and 30),
  drop constraint if exists chk_drivers_whatsapp,
  add constraint chk_drivers_whatsapp
    check (whatsapp is null or btrim(whatsapp) = ''
           or whatsapp ~ '^[0-9+()\s-]{7,20}$');

-- -------------------------------------------------------------------- rondas
alter table public.rounds
  drop constraint if exists chk_rounds_label,
  add constraint chk_rounds_label
    check (char_length(btrim(label)) between 3 and 80),
  drop constraint if exists chk_rounds_responsible,
  add constraint chk_rounds_responsible
    check (responsible is null or char_length(responsible) <= 80),
  drop constraint if exists chk_rounds_notes,
  add constraint chk_rounds_notes
    check (notes is null or char_length(notes) <= 500);

-- -------------------------------------------------------------- inspecciones
-- Un camión de carga no supera el millón de kilómetros en su vida útil; el tope
-- deja margen de sobra y descarta digitaciones imposibles.
alter table public.inspections
  drop constraint if exists chk_inspections_km_inicial,
  add constraint chk_inspections_km_inicial
    check (km_inicial is null or (km_inicial >= 0 and km_inicial <= 9999999)),
  drop constraint if exists chk_inspections_km_final,
  add constraint chk_inspections_km_final
    check (km_final is null or (km_final >= 0 and km_final <= 9999999)),
  -- El regreso nunca puede tener menos kilómetros que la salida.
  drop constraint if exists chk_inspections_km_coherente,
  add constraint chk_inspections_km_coherente
    check (km_final is null or km_inicial is null or km_final >= km_inicial),
  drop constraint if exists chk_inspections_obs,
  add constraint chk_inspections_obs
    check (obs_general is null or char_length(obs_general) <= 1000);

-- ------------------------------------------------------------------ novedades
alter table public.issues
  drop constraint if exists chk_issues_description,
  add constraint chk_issues_description
    check (description is null or char_length(description) <= 1000),
  drop constraint if exists chk_issues_resolution,
  add constraint chk_issues_resolution
    check (resolution_note is null or char_length(resolution_note) <= 1000);

-- ------------------------------------------------------------------ checklist
alter table public.checklist_items
  drop constraint if exists chk_items_name,
  add constraint chk_items_name
    check (char_length(btrim(name)) between 2 and 100);

alter table public.checklist_categories
  drop constraint if exists chk_categories_name,
  add constraint chk_categories_name
    check (char_length(btrim(name)) between 2 and 60);

-- -------------------------------------------------------------------- perfiles
alter table public.profiles
  drop constraint if exists chk_profiles_name,
  add constraint chk_profiles_name
    check (full_name is null or char_length(full_name) <= 80);
