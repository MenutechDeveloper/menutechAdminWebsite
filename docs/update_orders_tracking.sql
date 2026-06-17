-- SQL to add tracking and timestamps to menutech_orders
-- This ensures the table has all columns needed for real-time tracking and rejection motives.

DO $$
BEGIN
    -- 1. Add rejection_reason column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='rejection_reason') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN rejection_reason TEXT;
    END IF;

    -- 2. Add timestamp columns for tracking status changes
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='accepted_at') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN accepted_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='preparing_at') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN preparing_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='ready_at') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN ready_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='delivered_at') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN delivered_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menutech_orders' AND column_name='rejected_at') THEN
        ALTER TABLE public.menutech_orders ADD COLUMN rejected_at TIMESTAMPTZ;
    END IF;
END $$;

COMMENT ON COLUMN public.menutech_orders.status IS 'Status: pending, accepted, preparing, finished, delivered, rejected';
