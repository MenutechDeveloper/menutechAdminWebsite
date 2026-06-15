-- SQL update for Menutech Orders RLS
-- This ensures administrators, developers, and CS roles can view and manage all orders.
-- Copy and run this in your Supabase SQL Editor.

-- Ensure RLS is enabled
ALTER TABLE public.menutech_orders ENABLE ROW LEVEL SECURITY;

-- 1. Management access: Owners can manage their own orders, admins/devs/CS can manage all.
-- Using LOWER() to ensure case-insensitive role matching.
DO $$ BEGIN
    DROP POLICY IF EXISTS "Management access for orders" ON public.menutech_orders;
    CREATE POLICY "Management access for orders" ON public.menutech_orders FOR ALL USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND LOWER(profiles.role) IN ('admin', 'developer', 'admincs', 'cs')
        )
    );
EXCEPTION WHEN others THEN NULL; END $$;

-- 2. Profiles access: Admins/CS need to list profiles to use the context switcher.
DO $$ BEGIN
    DROP POLICY IF EXISTS "Admins and CS can view all profiles" ON public.profiles;
    CREATE POLICY "Admins and CS can view all profiles" ON public.profiles FOR SELECT USING (
        auth.uid() = id OR
        EXISTS (
            SELECT 1 FROM public.profiles AS p
            WHERE p.id = auth.uid()
            AND LOWER(p.role) IN ('admin', 'developer', 'admincs', 'cs')
        )
    );
EXCEPTION WHEN others THEN NULL; END $$;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
