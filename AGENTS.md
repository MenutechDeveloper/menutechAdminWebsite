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
- `link_existing_account` re-attaches an `acct_...` that already exists in Stripe (validated with
  `GET /v1/accounts/{id}` before upsert). Needed because `disconnect_account` only deletes the local
  row, so without it the only way back was creating a brand-new account and orphaning the old one.
- Account creation retries without the `recipient` configuration when the sandbox rejects the full
  v2 payload, then tries to add `recipient` in a follow-up `POST /v2/core/accounts/{id}`. The
  merchant-only path keeps "own Stripe" working; commission mode stays blocked until an account can
  actually receive transfers.
- Commission % autosaves on change (debounced, no Save button). The rate is always stored; the mode
  only flips to `menutech_commission` once `can_receive` is true, so a fee is never charged to the
  platform by accident.

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
  The return/refresh URLs also carry `owner_id` so an admin reopens the same restaurant instead of
  falling back to the first one in the sidebar.
- The owner "connect Stripe" panel is shown for **both** `own_stripe` and `menutech_commission`,
  because commission mode also needs the restaurant's bank account (captured by Stripe onboarding).
- `disconnect_account` only deletes the `menutech_stripe_accounts` row (Stripe cannot delete Connect
  accounts) and resets `payment_mode` to `none`, keeping `commission_rate`. Reconnecting therefore
  creates a **new** Stripe account, leaving the old one orphaned — so switch modes with the mode
  buttons, never by disconnecting.
- `adminStartStripeConnect` must not force `payment_mode = own_stripe` unless the mode is `none`;
  doing so silently overwrote an authorized commission config. The commission tab has its own
  `adminConnectPayouts` button that only opens onboarding.

## Charge types: destination + restaurant-paid Stripe fee
Both modes use **destination charges**: `payment_intent_data[transfer_data][destination]` (NOT
top-level `transfer_data[destination]`, which is not a valid Checkout parameter) plus
`payment_intent_data[application_fee_amount]`. The platform is the merchant of record and Stripe
debits its processing fee from the platform's balance. Express accounts force
`defaults.responsibilities.fees_collector = "application"`.

The customer pays only the order total (no surcharge). The platform pays Stripe's processing fee
and recovers it through the application fee, so the restaurant bears the fee:

- `own_stripe`: application fee = estimated Stripe fee (`STRIPE_FEE_PERCENT` /
  `STRIPE_FEE_FIXED_CENTS`, default 2.9% + 30¢). The restaurant receives `order_total - fee`;
  Menutech nets 0.
- `menutech_commission`: application fee = estimated Stripe fee + `order_total * commission_rate`.
  The restaurant receives `order_total - commission - fee`; Menutech keeps the full commission.

`estimateStripeFeeCents()` is an estimate: set the env vars to match your Stripe pricing
(international cards cost more).

Readiness: **both** modes need the account to **receive** funds (`capabilities.transfers === "active"`
OR `payouts_enabled`). `charges_enabled` is for direct charges and is **not** required: the platform
processes the card and sends a destination transfer, so a recipient-only Express account works.
`resolveReceivingAccount()` returns all three and each action checks `ready`.

PaymentIntent metadata (`payment_intent_data[metadata][...]`) is set alongside session metadata so
`payment_intent.payment_failed` and `charge.refunded` can find the order; those events do not
inherit the Checkout Session metadata.

Stripe has no API to push money to a bank account without a connected account, so restaurants in
commission mode still complete Connect onboarding once to enter their bank account. The payout
to their bank is automatic afterwards. `stripe-webhook` stores `payment_mode`, `charge_type`,
`commission_rate`, `commission_amount`, `stripe_fee_pass_through`, `net_amount` and
`destination_account` in `menutech_payment_logs.payload`.

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

## Customer notification emails (`mailgun-email`)
`mailgun-email` sends the "your order is ready" / "your table is ready" email. It is invoked from
`adminOrders.html` and from the Flutter app (`order_detail_screen.dart`) when an order moves to
`finished` or a reservation to `attended`.

Secrets: `mailgunApi` (required, Mailgun **Private** API key), optional `MAILGUN_DOMAIN`
(defaults to `mg.menutech.io`), `MAILGUN_REGION` (`us`/`eu`), `MAILGUN_API_BASE`, `MAILGUN_FROM`.
A key from an **EU-region** domain only authenticates against `api.eu.mailgun.net`; the function
tries the other region on 401/403/404, so a region mismatch no longer fails silently.
`POST {action:"verify"}` lists the domains each region accepts and is the quickest way to tell a
bad key (401 everywhere) from a missing domain (404).

The function resolves branding server-side (service role) by merging `menutech_restaurants`,
`menutech_web_templates.config` (`title`, `logoImg`, `contact`), `menutech_menus.config`
(`restaurant_name`), `menutech_footers.config` (`logo`, `primaryColor`) and
`menutech_tickets.config` (`logo_url`) — the same precedence used by `restaurantInfo.html`.
It also re-reads the order/reservation row, so the client cannot fake the recipient or totals.

`email_notified_at` (see `docs/add_email_notified_at.sql`) makes sending idempotent: a second
"ready" action skips the email. Pass `force: true` to resend. The column is optional — if the
migration has not been run the send still works, only dedupe is disabled.
