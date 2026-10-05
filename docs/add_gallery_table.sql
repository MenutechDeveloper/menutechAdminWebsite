-- ====================================================================
-- MENUTECH GALLERY TABLE SCHEMA (public.galeria)
-- Execute this SQL in your Supabase SQL Editor to set up the gallery table
-- ====================================================================

-- 1. Ensure uuid extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create public.galeria table
CREATE TABLE IF NOT EXISTS public.galeria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    domain TEXT,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_galeria_user_id ON public.galeria (user_id);
CREATE INDEX IF NOT EXISTS idx_galeria_domain ON public.galeria (domain);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.galeria ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DO $$
BEGIN
    DROP POLICY IF EXISTS "Public can view gallery images" ON public.galeria;
    DROP POLICY IF EXISTS "Users can insert their gallery images" ON public.galeria;
    DROP POLICY IF EXISTS "Users can update their gallery images" ON public.galeria;
    DROP POLICY IF EXISTS "Users can delete their gallery images" ON public.galeria;
END $$;

-- Policy: Anyone can view gallery images (for digital menus & websites)
CREATE POLICY "Public can view gallery images"
    ON public.galeria FOR SELECT
    USING (true);

-- Policy: Authenticated users can insert their own gallery images
CREATE POLICY "Users can insert their gallery images"
    ON public.galeria FOR INSERT
    WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

-- Policy: Authenticated users can update their own gallery images
CREATE POLICY "Users can update their gallery images"
    ON public.galeria FOR UPDATE
    USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- Policy: Authenticated users can delete their own gallery images
CREATE POLICY "Users can delete their gallery images"
    ON public.galeria FOR DELETE
    USING (auth.uid() = user_id OR auth.role() = 'service_role');
