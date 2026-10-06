-- Supabase publica el esquema `public` por su API REST (PostgREST). LatinSoftGestion no usa esa API:
-- accede solo por Prisma con el rol dueño de las tablas, que no está sujeto a RLS.
-- Activar RLS sin políticas deja la API REST sin acceso a ninguna fila.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
