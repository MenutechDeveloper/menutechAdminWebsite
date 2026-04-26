-- Menutech: SQL for Web Templates Module
-- This table stores the configuration for restaurant websites generated via the Template Web module.

CREATE TABLE IF NOT EXISTS public.menutech_web_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_user_template UNIQUE (user_id)
);

-- Enable RLS
ALTER TABLE public.menutech_web_templates ENABLE ROW LEVEL SECURITY;

-- Policies
-- 1. Users can view and manage their own template
CREATE POLICY "Users can manage their own templates"
    ON public.menutech_web_templates
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 2. Admins and specialized roles can manage all templates
-- Assuming profiles table exists with role column
CREATE POLICY "Admins can manage all templates"
    ON public.menutech_web_templates
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role IN ('admin', 'developer', 'adminCS', 'CS')
        )
    );

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_web_templates_user_id ON public.menutech_web_templates (user_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS set_updated_at ON public.menutech_web_templates;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.menutech_web_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
