-- =========================================================
-- Re-link an existing Stripe Connect account (acct_...)
-- =========================================================
-- Use this when a restaurant already has a Connect account in Stripe but
-- Menutech shows "Not Connected". That happens after "Disconnect", because
-- the disconnect action only deletes the row in menutech_stripe_accounts
-- (Stripe never deletes Connect accounts).
--
-- 1) Find the account id in the Stripe Dashboard:
--      Connect -> Connected accounts -> click the restaurant -> acct_...
-- 2) Replace the two placeholders below and run this file.

-- The restaurant's profile id (user_id used everywhere in Menutech).
-- Find it in Supabase: select id, username, domain from profiles;
\set owner_id 'PUT-THE-USER-UUID-HERE'
\set acct_id  'acct_PUT-THE-ACCOUNT-ID-HERE'

-- Keep the existing payment configuration untouched (mode + commission rate).
insert into public.menutech_stripe_accounts
    (user_id, stripe_account_id, details_submitted, charges_enabled, payouts_enabled, country, currency, updated_at)
values
    (:'owner_id', :'acct_id', false, false, false, 'US', 'usd', now())
on conflict (user_id) do update
    set stripe_account_id = excluded.stripe_account_id,
        updated_at        = now();

-- After running this, open onlinePayment.html, select the restaurant and click
-- "Check Status". That pulls charges_enabled / payouts_enabled straight from
-- Stripe and refreshes the badges (a webhook account.updated also does it).
--
-- You normally do NOT need this file: after a disconnect the panel shows a
-- "Reconnect Account" button that restores the same account by itself. Use this
-- script only when that stored account is wrong, or before
-- add_last_stripe_account_id.sql exists.

-- Verify:
-- select user_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted
-- from public.menutech_stripe_accounts where user_id = :'owner_id';
