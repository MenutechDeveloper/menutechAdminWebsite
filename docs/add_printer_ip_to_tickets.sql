-- Add printer_ip column to menutech_tickets table
ALTER TABLE public.menutech_tickets
ADD COLUMN IF NOT EXISTS printer_ip TEXT;

-- Update the config JSONB default if needed (optional since we have a dedicated column now)
-- The dedicated column is better for easy access in the app.
