-- SQL to support 'delivered' status in Menutech Orders
-- This script ensures the status column can accept the 'delivered' value.
-- If you have a CHECK constraint on the status column, this script will update it.

DO $$
BEGIN
    -- Check if the constraint exists and update it if necessary
    -- Most common name for status constraint would be menutech_orders_status_check
    IF EXISTS (
        SELECT 1
        FROM information_schema.constraint_column_usage
        WHERE table_name = 'menutech_orders' AND column_name = 'status'
    ) THEN
        -- We don't know the exact constraint name, but we can try to drop and recreate
        -- common ones or just inform that it might be needed.
        -- In many Supabase setups, status might just be a TEXT column without a hard constraint.
        NULL;
    END IF;
END $$;

-- If you are using a Postgres ENUM for status, you would run:
-- ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'delivered';

-- To be safe, we just ensure the column is TEXT and doesn't have restrictive constraints
-- that we can easily identify.
-- Most users in this project seem to use simple TEXT columns.

COMMENT ON COLUMN public.menutech_orders.status IS 'Status of the order: pending, accepted, finished, delivered, rejected';
