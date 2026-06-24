-- SQL Fix for Public (Anonymous) Orders in Menutech
-- This script allows any user (logged in or not) to place orders.
-- It is designed to be ADDITIVE and will not remove your existing policies.
-- Run this in your Supabase SQL Editor.

-- 1. Enable RLS on the table if it's not already enabled
ALTER TABLE public.menutech_orders ENABLE ROW LEVEL SECURITY;

-- 2. Create policy to allow ANYONE to insert orders
-- This allows customers to place orders from the website.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'menutech_orders'
        AND policyname = 'Allow public insert'
    ) THEN
        CREATE POLICY "Allow public insert" ON public.menutech_orders
        FOR INSERT
        TO anon, authenticated
        WITH CHECK (true);
    END IF;
END $$;

-- 3. Create policy to allow ANYONE to select orders (for tracking)
-- REQUIRED: This is necessary so customers can see their order status in the tracking screen.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'menutech_orders'
        AND policyname = 'Allow public select'
    ) THEN
        CREATE POLICY "Allow public select" ON public.menutech_orders
        FOR SELECT
        TO anon, authenticated
        USING (true);
    END IF;
END $$;

-- 4. Add Management Access (Owners and Admins)
-- This ensures that restaurant owners can see their own orders and admins can see all.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'menutech_orders'
        AND policyname = 'Management access v2'
    ) THEN
        EXECUTE 'CREATE POLICY "Management access v2" ON public.menutech_orders
        FOR ALL
        TO authenticated
        USING (
            auth.uid() = user_id OR
            EXISTS (
                SELECT 1 FROM public.profiles
                WHERE profiles.id = auth.uid()
                AND (profiles.role = ''admin'' OR profiles.role = ''developer'' OR profiles.role = ''adminCS'' OR profiles.role = ''CS'')
            )
        )';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Management policy skipping...';
END $$;

-- 5. Enable Realtime
ALTER TABLE public.menutech_orders REPLICA IDENTITY FULL;

-- Add to publication if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'menutech_orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.menutech_orders;
    END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Notify PostgREST
NOTIFY pgrst, 'reload schema';
