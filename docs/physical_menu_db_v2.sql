-- Non-destructive migration for menutech_physical_menus
-- Ensure table exists
CREATE TABLE IF NOT EXISTS public.menutech_physical_menus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    layout_config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, template_id)
);

-- Enable RLS
ALTER TABLE public.menutech_physical_menus ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid duplicates
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can view their own physical menus" ON public.menutech_physical_menus;
    DROP POLICY IF EXISTS "Admins can view all physical menus" ON public.menutech_physical_menus;
    DROP POLICY IF EXISTS "Users can insert their own physical menus" ON public.menutech_physical_menus;
    DROP POLICY IF EXISTS "Users can update their own physical menus" ON public.menutech_physical_menus;
END $$;

-- Policies
CREATE POLICY "Users can view their own physical menus"
    ON public.menutech_physical_menus FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all physical menus"
    ON public.menutech_physical_menus FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND (LOWER(role) = 'admin' OR LOWER(role) = 'developer' OR LOWER(role) = 'cs' OR LOWER(role) = 'admincs')
        )
    );

CREATE POLICY "Users can insert their own physical menus"
    ON public.menutech_physical_menus FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own physical menus"
    ON public.menutech_physical_menus FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
