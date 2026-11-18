-- Fix: online-payment orders were being cancelled instantly ("Payment timeout (10 minutes expired)")
-- because the Android app wrote accepted_at using the restaurant device's LOCAL time
-- (e.g. DateTime.now().toIso8601String() -> "2026-11-17T22:41:56" with no offset). Postgres stored
-- it as UTC, so accepted_at landed hours in the past and every 10-minute timeout check saw the
-- order as already expired.
--
-- An order can never be accepted before it was created, so we clamp accepted_at to created_at.
-- This fixes the data server-side for every client, including older app builds still installed.

-- 1. Repair existing rows that were saved with the skewed timestamp.
UPDATE public.menutech_orders
SET accepted_at = created_at
WHERE accepted_at IS NOT NULL
  AND created_at IS NOT NULL
  AND accepted_at < created_at;

-- 2. Prevent it from happening again on any insert/update.
CREATE OR REPLACE FUNCTION public.menutech_fix_order_timestamps()
RETURNS trigger AS $$
BEGIN
  IF NEW.accepted_at IS NOT NULL
     AND NEW.created_at IS NOT NULL
     AND NEW.accepted_at < NEW.created_at THEN
    NEW.accepted_at := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_menutech_fix_order_timestamps ON public.menutech_orders;
CREATE TRIGGER trg_menutech_fix_order_timestamps
BEFORE INSERT OR UPDATE ON public.menutech_orders
FOR EACH ROW EXECUTE FUNCTION public.menutech_fix_order_timestamps();
