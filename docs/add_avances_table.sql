-- ====================================================================
-- MENUTECH AVANCES TABLE SCHEMA (public.avances)
-- Ejecuta este SQL en el SQL Editor de Supabase para crear la tabla.
-- Guarda las funciones (antes "objetivos") de la página avance.html.
-- Los archivos (imagenes/videos) se suben a Cloudinary; aquí se guarda
-- la URL y las notas/dibujos de cada imagen.
--
-- IMPORTANTE: si la página avance.html muestra el aviso
--   "Falta crear la tabla 'avances' en Supabase"
-- es porque este SQL todavía no se ha ejecutado en este proyecto.
-- Pega TODO este archivo en el SQL Editor y pulsa "Run".
-- ====================================================================

-- 1. Extension uuid (por si el proyecto no la tiene)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabla
CREATE TABLE IF NOT EXISTS public.avances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    progress INTEGER NOT NULL DEFAULT 0,
    -- media: [{ type: "image"|"video", url, notes: [{id,text,x,y}], strokes: [{tool,color,w,pts:[{x,y}]}] }]
    media JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- subfunctions: [{ id, title, description, progress, media, subfunctions: [] }]
    subfunctions JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indices
CREATE INDEX IF NOT EXISTS idx_avances_sort_order ON public.avances (sort_order);
CREATE INDEX IF NOT EXISTS idx_avances_created_at ON public.avances (created_at);

-- 3b. Si la tabla ya existia sin subfunciones, se agrega la columna
ALTER TABLE public.avances
    ADD COLUMN IF NOT EXISTS subfunctions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 4. Row Level Security
ALTER TABLE public.avances ENABLE ROW LEVEL SECURITY;

-- 5. Policies
DO $$
BEGIN
    DROP POLICY IF EXISTS "Public can view avances" ON public.avances;
    DROP POLICY IF EXISTS "Admins can manage avances" ON public.avances;
END $$;

-- Cualquiera puede ver los avances (página pública)
CREATE POLICY "Public can view avances"
    ON public.avances FOR SELECT
    USING (true);

-- Solo administradores pueden crear, editar y borrar
CREATE POLICY "Admins can manage avances"
    ON public.avances FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );
