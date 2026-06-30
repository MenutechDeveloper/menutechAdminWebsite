-- Standardize RLS policies for menutech_tickets and menutech_web_templates
-- This ensures administrative roles can manage all records, enabling context-switching sync.

DO $$
BEGIN
    -- 1. CLEANUP AND STANDARDIZE menutech_tickets
    -- Drop existing specific update policy to replace it with a unified 'ALL' policy for admins/owners
    DROP POLICY IF EXISTS "Users can update their own ticket config" ON public.menutech_tickets;
    DROP POLICY IF EXISTS "Admins can manage all ticket configs" ON public.menutech_tickets;

    CREATE POLICY "Manage all ticket configs"
    ON public.menutech_tickets
    FOR ALL
    USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND LOWER(role) IN ('admin', 'developer', 'admincs', 'cs')
        )
    )
    WITH CHECK (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND LOWER(role) IN ('admin', 'developer', 'admincs', 'cs')
        )
    );

    -- 2. CLEANUP AND STANDARDIZE menutech_web_templates
    -- Drop existing to ensure a fresh, consistent policy matching the project's requirements
    DROP POLICY IF EXISTS "Users can manage their own templates" ON public.menutech_web_templates;
    DROP POLICY IF EXISTS "Admins can manage all templates" ON public.menutech_web_templates;

    CREATE POLICY "Manage all web templates"
    ON public.menutech_web_templates
    FOR ALL
    USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND LOWER(role) IN ('admin', 'developer', 'admincs', 'cs')
        )
    )
    WITH CHECK (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND LOWER(role) IN ('admin', 'developer', 'admincs', 'cs')
        )
    );

END $$;
