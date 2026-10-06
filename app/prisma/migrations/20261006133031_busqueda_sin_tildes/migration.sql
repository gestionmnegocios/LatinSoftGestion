-- Búsqueda de texto que ignora tildes y mayúsculas ("clinica" encuentra "Clínica").
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() no es IMMUTABLE; este envoltorio con diccionario explícito sí lo es,
-- lo que permite usarlo en índices si las tablas crecen.
CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $func$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$func$;
