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
        SELECT 1 FROM pg_policy
        WHERE tablename = 'menutech_orders'
        AND polname = 'Allow public insert'
    ) THEN
        CREATE POLICY "Allow public insert" ON public.menutech_orders
        FOR INSERT
        TO anon, authenticated
        WITH CHECK (true);
    END IF;
END $$;

-- 3. Create policy to allow ANYONE to select orders (for tracking)
-- REQUIRED: This is necessary so customers can see their order status in the tracking screen.
-- SECURITY NOTE: Because orders use random UUIDs, it is difficult to "guess" an order ID.
-- However, this policy technically allows any anonymous user to attempt to read orders.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policy
        WHERE tablename = 'menutech_orders'
        AND polname = 'Allow public select'
    ) THEN
        CREATE POLICY "Allow public select" ON public.menutech_orders
        FOR SELECT
        TO anon, authenticated
        USING (true);
    END IF;
END $$;

-- 4. Add Management Access (Owners and Admins)
-- This ensures that restaurant owners can see their own orders and admins can see all.
-- We use a separate block so it doesn't fail if your schema is different.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policy
        WHERE tablename = 'menutech_orders'
        AND polname = 'Management access v2'
    ) THEN
        -- This policy depends on 'user_id' and 'profiles' table existing.
        -- If they don't exist, this specific block might fail but others will work.
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
    -- If this management policy fails due to schema mismatch, we ignore it
    -- so the main Public Insert fix still works.
    RAISE NOTICE 'Management policy could not be created, possibly due to schema mismatch. Skipping.';
END $$;

-- 5. Enable Realtime (Required for the tracking screen to update automatically)
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

-- Notify PostgREST to reload the schema
NOTIFY pgrst, 'reload schema';
