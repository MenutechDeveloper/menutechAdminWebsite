-- Create the table for Web Templates
CREATE TABLE IF NOT EXISTS public.menutech_web_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    domain TEXT,
    config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.menutech_web_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Owners can manage their own template
CREATE POLICY "Owners can manage their own template"
ON public.menutech_web_templates
FOR ALL
USING (auth.uid() = user_id);

-- Admins, Developers, and CS can manage any template
CREATE POLICY "Privileged roles can manage any template"
ON public.menutech_web_templates
FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'developer', 'adminCS', 'CS')
    )
);

-- Function to update the updated_at column
CREATE OR REPLACE FUNCTION public.handle_web_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE TRIGGER set_web_template_updated_at
BEFORE UPDATE ON public.menutech_web_templates
FOR EACH ROW
EXECUTE FUNCTION public.handle_web_template_updated_at();
