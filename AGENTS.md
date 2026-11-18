# Menutech — Repository Notes

Static admin site + customer menu widgets + Supabase backend + Flutter Android app.

## Layout
- `docs/` — the deployed website (GitHub Pages). `menutechUI.js` holds the customer-facing
  Web Components (`<menutech-platform-orders>`, `<menutech-footer>`, etc.). `adminOrders.html`,
  `adminMenus.html`, `adminOnlinePayment.html` are the admin pages.
- `supabase/functions/` — Deno Edge Functions: `stripe-payment`, `stripe-webhook`,
  `stripe-connect`, `gemini-chat`.
- `android/` — Flutter app for restaurant owners (order notifications, printer, chatbot widget).

## Online payment flow (customer + restaurant)
1. Customer picks `payment_method: 'online'` in the cart; order is created `status='pending'`,
   `payment_status='unpaid'`.
2. Restaurant accepts in the Android app → `status='accepted'`, `accepted_at` set.
3. Customer tracking shows the **Stripe Embedded Checkout** form at the top (step `Pay`).
   `stripe-payment` `create_order_checkout_session` with `ui_mode:'embedded'` returns a
   `client_secret`; the widget mounts it with Stripe.js `initEmbeddedCheckout` (the mount target
   is a Shadow DOM element, so the element — not a selector — is passed to `checkout.mount`).
4. On success the step `Pay` is checked and the flow advances to `Preparing`
   (`payment_status='paid'`, `status='preparing'`). `stripe-webhook` is the source of truth;
   the widget also calls `confirm_order_payment` for instant UI feedback.
5. If the customer does not pay within 10 minutes (from `accepted_at`) the order is cancelled
   via `cancel_order_payment` (service role, also expires the Stripe session).
- Cash / pay-at-restaurant orders skip the whole `Pay` step.

## Secrets (Supabase → Project Settings → Edge Functions → Secrets)
- `stripe_api` — Stripe secret key (`sk_...`).
- `stripe_publishable` — Stripe publishable key (`pk_...`), exposed to the browser via the
  `get_stripe_config` action so the widget can init Stripe.js.
- `STRIPE_API_VERSION` (optional) — overrides the `Stripe-Version` header used by v2 API calls
  (defaults to `2026-10-28.endive`).

## Stripe Connect accounts (online payments activation)
`stripe-connect` creates connected accounts with the **Accounts v2 API** (`POST /v2/core/accounts`).
Stripe blocks creating Accounts via `POST /v1/accounts` for new Connect integrations
(`accounts_v1_support`), which returned the error the admin saw in `onlinePayment.html`.
- Account creation is JSON + `Stripe-Version` header (v2 namespace; v1 uses form-encoding).
- Config mirrors the old `type=express`: `dashboard:"express"`, merchant `card_payments`,
  recipient `stripe_balance.stripe_transfers`, and `defaults.responsibilities` both `application`
  (required when `dashboard` is `express`).
- Onboarding uses `POST /v2/core/account_links` with
  `use_case.account_onboarding.{return_url,refresh_url}`. The **legacy test-mode sandbox only
  partially supports API v2**, and creating a v2 account link for an account with a `recipient`
  configuration is rejected there (`Please switch to an account created in a sandbox to test`), so
  the code falls back to the v1 endpoint `POST /v1/account_links` (v1 endpoints accept v2 Account
  IDs). To test v2 end-to-end, use a **general sandbox** instead of the legacy test-mode sandbox.
- Status reads use `GET /v2/core/accounts/{id}?include[]=...`; v2 outstanding requirements live
  under `requirements.entries` (not `currently_due`/`past_due`), and capabilities under
  `configuration.<config>.capabilities.<cap>.status === "active"`.
- The flat `menutech_stripe_accounts` columns are derived via `mapV2AccountToRecord()`, so the UI
  and `stripe-webhook` (which still handles v1 `account.updated`) need no changes.
- Login links (Express Dashboard) keep using `/v1/accounts/{id}/login_links`; v1 endpoints accept
  v2 Account IDs.

## Destination charges (Connect mode)
In Checkout Sessions the transfer parameter is `payment_intent_data[transfer_data][destination]`
(NOT top-level `transfer_data[destination]`, which is not a valid Checkout parameter). Commission
mode (`menutech_commission`) uses the same transfer plus
`payment_intent_data[application_fee_amount]`; with no connected account it charges the platform
directly.

## Conventions
- Customer client is anonymous; `menutech_orders` has public INSERT/SELECT RLS but **no public
  UPDATE** policy. Any customer-triggered state change must go through an Edge Function using the
  service role (e.g. `cancel_order_payment`), not a direct table update.
- Validate JS with `node --check docs/menutechUI.js`; type-check edge functions with
  `npx esbuild supabase/functions/<fn>/index.ts --bundle=false --outfile=/tmp/out.js --loader:.ts=ts`.
- **Timestamps must be UTC.** The Flutter app must write timestamps with
  `DateTime.now().toUtc().toIso8601String()` (never `DateTime.now().toIso8601String()`, which emits
  local time with no offset and Postgres then stores it as UTC). A skew here made `accepted_at`
  land hours in the past and every 10-minute timeout check cancelled online orders instantly.
  As a safety net, `docs/fix_order_accepted_at_timezone.sql` clamps `accepted_at >= created_at`
  with a DB trigger, and the web/admin/app timeout checks ignore `accepted_at < created_at`.
