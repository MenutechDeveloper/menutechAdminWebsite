-- =========================================================
-- Remember the last connected Stripe account after a disconnect
-- =========================================================
-- Disconnect only unlinks the account locally; Stripe never deletes Connect
-- accounts. This column keeps the acct_... so the admin can reconnect the
-- SAME account instead of creating a duplicate one.
--
-- Run once in the Supabase SQL Editor. Until this is applied the edge function
-- falls back to disconnecting without saving the id (no error, just no
-- "Reconnect Account" button afterwards).

ALTER TABLE public.menutech_restaurant_payment_configs
    ADD COLUMN IF NOT EXISTS last_stripe_account_id TEXT;

-- Reload PostgREST schema cache so the new column is immediately selectable.
NOTIFY pgrst, 'reload schema';
