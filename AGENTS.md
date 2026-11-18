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
- Status reads (`get_account_status`) use `GET /v1/accounts/{id}` as the **source of truth** for
  `charges_enabled` / `payouts_enabled` / `details_submitted`: the v1 retrieve endpoint is fully
  supported (even for accounts created through v2) and returns those booleans directly. A v2 read
  (`GET /v2/core/accounts/{id}?include[]=...`) is only a fallback, and stored values are the last
  resort. In v2, outstanding requirements live under `requirements.entries` (not
  `currently_due`/`past_due`) and capabilities under
  `configuration.<config>.capabilities.<cap>.status === "active"`; this is why v1 is preferred for
  a plain boolean status.
- The flat `menutech_stripe_accounts` columns are derived via `mapV2AccountToRecord()` for the
  create/fallback paths, so the UI and `stripe-webhook` (which handles v1 `account.updated`) need
  no changes.
- Login links (Express Dashboard) keep using `/v1/accounts/{id}/login_links`; v1 endpoints accept
  v2 Account IDs.

## Online payments: roles & activation
- Activation is **admin-only**: `ADMIN`/`SUPERADMIN` enable the service (`menutech_restaurant_payment_configs.service_status`)
  and choose the mode (`own_stripe` vs `menutech_commission`) from `onlinePayment.html`. There is
  no customer-facing subscribe button.
- Restaurant `OWNER`s may open `onlinePayment.html` and see **only their own** read-only status,
  movements, and — when the mode is `own_stripe` — a "Connect with Stripe" button. They never see
  the admin sections (Service Access / General Account Information).
- `stripe-connect` resolves the caller's own `user_id` when no `target_user_id` is sent, so an owner
  can create/reuse their own onboarding link without extra permissions. `isPrivileged` includes
  `ADMIN`, `SUPERADMIN`, `DEVELOPER`, `CS`, `ADMINCS`.
- `index.html` shows the Online Payment card to an owner only when `profiles.services_enabled.online_payment === true`.
- Returning from Stripe (`?stripe_return=true`) must call `get_account_status` before rendering;
  it does **not** happen automatically otherwise, and Supabase still holds the pre-onboarding values.

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
