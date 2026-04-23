-- SQL Fix for Menutech Orders Table
-- This script ensures that all required columns for the checkout flow exist.
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
END $$;

-- Optional: Refresh schema cache (Supabase does this automatically, but good to have)
-- NOTIFY pgrst, 'reload schema';
