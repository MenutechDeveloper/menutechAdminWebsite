-- SQL Schema for Menutech Physical Menus
-- This table stores the layout and configuration for printable menus.

CREATE TABLE IF NOT EXISTS public.menutech_physical_menus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL DEFAULT 'template1',
    layout_config JSONB DEFAULT '{
        "elements": [],
        "settings": {
            "pageSize": "letter",
            "orientation": "portrait"
        }
    }'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, template_id)
);

-- Enable Row Level Security
ALTER TABLE public.menutech_physical_menus ENABLE ROW LEVEL SECURITY;

-- Policies
DO $$ BEGIN
    DROP POLICY IF EXISTS "Management access for physical menus" ON public.menutech_physical_menus;
    CREATE POLICY "Management access for physical menus" ON public.menutech_physical_menus FOR ALL USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND UPPER(profiles.role) IN ('ADMIN', 'DEVELOPER', 'CS', 'ADMINCS')
        )
    );
EXCEPTION WHEN others THEN NULL; END $$;

-- Trigger for updated_at (assumes update_updated_at_column function exists)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_menutech_physical_menus_updated_at') THEN
        CREATE TRIGGER update_menutech_physical_menus_updated_at
        BEFORE UPDATE ON public.menutech_physical_menus
        FOR EACH ROW
        EXECUTE PROCEDURE update_updated_at_column();
    END IF;
EXCEPTION WHEN others THEN NULL; END $$;
