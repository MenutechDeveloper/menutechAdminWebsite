-- Table to store assets (Backgrounds and Textures)
CREATE TABLE IF NOT EXISTS public.menutech_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    url TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('background', 'texture')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.menutech_assets ENABLE ROW LEVEL SECURITY;

-- Policies
DO $$
BEGIN
    DROP POLICY IF EXISTS "Anyone can view assets" ON public.menutech_assets;
    DROP POLICY IF EXISTS "Admins can manage assets" ON public.menutech_assets;
END $$;

CREATE POLICY "Anyone can view assets"
    ON public.menutech_assets FOR SELECT
    USING (true);

CREATE POLICY "Admins can manage assets"
    ON public.menutech_assets FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND (LOWER(role) = 'admin' OR LOWER(role) = 'developer' OR LOWER(role) = 'cs' OR LOWER(role) = 'admincs')
        )
    );
