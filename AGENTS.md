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
