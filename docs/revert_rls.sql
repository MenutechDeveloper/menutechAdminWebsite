-- SQL REVERT: Run this to undo recent RLS changes and restore stability
-- This script removes recursive policies and restores original role-based access.

-- 1. Restore original Orders management policy (Case-sensitive)
DO $$ BEGIN
    DROP POLICY IF EXISTS "Management access for orders" ON public.menutech_orders;
    CREATE POLICY "Management access for orders" ON public.menutech_orders FOR ALL USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND (profiles.role = 'admin' OR profiles.role = 'developer' OR profiles.role = 'adminCS' OR profiles.role = 'CS')
        )
    );
EXCEPTION WHEN others THEN NULL; END $$;

-- 2. Remove the recursive Profiles policy that likely caused infinite recursion
DO $$ BEGIN
    DROP POLICY IF EXISTS "Admins and CS can view all profiles" ON public.profiles;
EXCEPTION WHEN others THEN NULL; END $$;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
