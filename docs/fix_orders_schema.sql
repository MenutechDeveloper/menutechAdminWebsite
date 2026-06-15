-- SQL Fix for Menutech Orders Table
-- This script ensures that all required columns for the checkout flow exist and that RLS policies are correctly set.
-- Copy and run this in your Supabase SQL Editor.

DO $$
BEGIN
    -- 1. Ensure address column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='address') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN address TEXT;
    END IF;

    -- 2. Ensure order_type column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='order_type') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN order_type TEXT DEFAULT 'pickup';
    END IF;

    -- 3. Ensure reference column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='reference') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN reference TEXT;
    END IF;

    -- 4. Ensure delivery_time_mode column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='delivery_time_mode') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN delivery_time_mode TEXT DEFAULT 'asap';
    END IF;

    -- 5. Ensure delivery_date column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='delivery_date') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN delivery_date TEXT;
    END IF;

    -- 6. Ensure delivery_time column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='delivery_time') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN delivery_time TEXT;
    END IF;

    -- 7. Ensure payment_method column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='payment_method') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN payment_method TEXT DEFAULT 'cash';
    END IF;

    -- 8. Ensure customer_notes column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='customer_notes') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN customer_notes TEXT;
    END IF;
END $$;

-- 9. Enable Row Level Security
ALTER TABLE public.menutech_orders ENABLE ROW LEVEL SECURITY;

-- 10. RLS Policies

-- Public can create orders: Essential for the cart to work on external websites
DO $$ BEGIN
    DROP POLICY IF EXISTS "Public can create orders" ON public.menutech_orders;
    CREATE POLICY "Public can create orders" ON public.menutech_orders FOR INSERT WITH CHECK (true);
EXCEPTION WHEN others THEN NULL; END $$;

-- Management access: Owners can manage their own orders, admins/devs/CS can manage all
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

-- IMPORTANT: If you still see "column not found" error after running this,
-- you may need to reload the PostgREST schema cache.
-- You can do this by running: NOTIFY pgrst, 'reload schema';
-- Or by restarting your Supabase project (rarely necessary).
