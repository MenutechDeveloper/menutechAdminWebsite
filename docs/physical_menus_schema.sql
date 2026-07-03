-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table to store physical menu designs
CREATE TABLE IF NOT EXISTS public.menutech_physical_menus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    layout_config JSONB NOT NULL DEFAULT '{"pages": [], "settings": {}}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, template_id)
);

-- Enable RLS
ALTER TABLE public.menutech_physical_menus ENABLE ROW LEVEL SECURITY;

-- Policies
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can manage their own physical menus') THEN
        CREATE POLICY "Users can manage their own physical menus"
        ON public.menutech_physical_menus
        FOR ALL
        TO authenticated
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage all physical menus') THEN
        CREATE POLICY "Admins can manage all physical menus"
        ON public.menutech_physical_menus
        FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.profiles
                WHERE id = auth.uid()
                AND role IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
            )
        );
    END IF;
END $$;
