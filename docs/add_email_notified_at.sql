-- Tracks when the "order ready" / "table ready" email was sent so the
-- mailgun-email Edge Function never sends the same notification twice.
-- Safe to run multiple times.
ALTER TABLE public.menutech_orders
    ADD COLUMN IF NOT EXISTS email_notified_at TIMESTAMPTZ;

ALTER TABLE public.menutech_reservations
    ADD COLUMN IF NOT EXISTS email_notified_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
