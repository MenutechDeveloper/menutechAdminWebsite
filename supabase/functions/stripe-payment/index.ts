// Supabase Edge Function: stripe-payment
// Creates Stripe Checkout sessions for orders and reservations with server-side price validation,
// Supports destination charges with application fees (Own Stripe fee pass-through
// and Menutech Commission),
// and supports Online Payments subscription checkout sessions.
// Required Secret: stripe_api

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeApiKey = (
      Deno.env.get("stripe_api") ||
      ""
    ).trim();

    if (!stripeApiKey) {
      return new Response(
        JSON.stringify({ error: "Secret 'stripe_api' no encontrada en Supabase. Configura el secret 'stripe_api' en tu proyecto." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const stripePublishableKey = (
      Deno.env.get("stripe_publishable") ||
      Deno.env.get("STRIPE_PUBLISHABLE_KEY") ||
      ""
    ).trim();

    const payload = await req.json().catch(() => ({}));
    const { action, order_id, reservation_id, target_user_id, origin_url, ui_mode } = payload;

    const baseOrigin = origin_url || req.headers.get("origin") || "https://menutech.io";
    // Stripe renamed the inline Checkout ui_mode from 'embedded' to 'embedded_page'.
    // Accept both so older clients keep working; we always send 'embedded_page' to Stripe.
    const embedded = ui_mode === "embedded" || ui_mode === "embedded_page";

    // Helper for Stripe REST API
    async function stripeFetch(endpoint: string, options: any = {}) {
      const url = `https://api.stripe.com/v1${endpoint}`;
      const headers = {
        "Authorization": `Bearer ${stripeApiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...options.headers
      };

      const res = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || `Stripe API error: ${res.status}`);
      }
      return data;
    }

    // Resolves the restaurant's connected account and its capabilities.
    // Destination charges need the account to RECEIVE funds (transfers / payouts).
    // Own Stripe mode also requires card_payments, i.e. a fully onboarded account.
    async function resolveReceivingAccount(userId: string) {
      const { data: rec } = await supabaseAdmin
        .from("menutech_stripe_accounts")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (!rec || !rec.stripe_account_id) {
        return { accountId: null, ready: false, record: rec, requirementsDue: [], reason: "no_account" };
      }

      try {
        const acc = await stripeFetch(`/accounts/${rec.stripe_account_id}`);
        const transfersActive = acc?.capabilities?.transfers === "active";
        const payoutsEnabled = !!acc?.payouts_enabled;
        const ready = transfersActive || payoutsEnabled;
        return {
          accountId: acc?.id || rec.stripe_account_id,
          ready,
          record: { ...rec, currency: acc?.default_currency || rec.currency },
          chargesEnabled: !!acc?.charges_enabled,
          payoutsEnabled,
          detailsSubmitted: !!acc?.details_submitted,
          requirementsDue: [
            ...(acc?.requirements?.currently_due || []),
            ...(acc?.requirements?.past_due || [])
          ],
          reason: ready ? null : "not_ready"
        };
      } catch (_e) {
        const ready = !!(rec.payouts_enabled || rec.charges_enabled);
        return {
          accountId: rec.stripe_account_id,
          ready,
          record: rec,
          chargesEnabled: !!rec.charges_enabled,
          payoutsEnabled: !!rec.payouts_enabled,
          detailsSubmitted: !!rec.details_submitted,
          requirementsDue: [],
          reason: ready ? null : "not_ready"
        };
      }
    }

    // Estimated Stripe processing fee on the order total. The platform pays Stripe and
    // recovers it through application_fee_amount, so the restaurant bears it.
    // Override with STRIPE_FEE_PERCENT / STRIPE_FEE_FIXED_CENTS if your pricing differs.
    const stripeFeePercentRaw = parseFloat(Deno.env.get("STRIPE_FEE_PERCENT") || "2.9");
    const stripeFeePercent = Number.isFinite(stripeFeePercentRaw)
      ? Math.max(0, Math.min(20, stripeFeePercentRaw))
      : 2.9;
    const stripeFeeFixedRaw = parseInt(Deno.env.get("STRIPE_FEE_FIXED_CENTS") || "30", 10);
    const stripeFeeFixedCents = Number.isFinite(stripeFeeFixedRaw) ? Math.max(0, stripeFeeFixedRaw) : 30;
    function estimateStripeFeeCents(amountCents: number) {
      if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
      return Math.min(amountCents, Math.round((amountCents * stripeFeePercent) / 100) + stripeFeeFixedCents);
    }

    // Keep the embedded Checkout form to a plain card entry for US customers:
    // - card only (filter over the Dashboard-managed method set)
    // - hide Link (the "pay securely with Link / email" option)
    // - disable Adaptive Pricing so no local-currency switcher appears (keeps the session currency)
    // - force English
    function applyCardOnlyCheckoutOptions(params: URLSearchParams) {
      params.append("allowed_payment_method_types[0]", "card");
      params.append("wallet_options[link][display]", "never");
      params.append("adaptive_pricing[enabled]", "false");
      params.append("locale", "en");
    }

    // Server-side price calculation helper using database menutech_menus
    function recalculateOrderTotal(menuConfig: any, orderItems: any[]): { calculatedTotal: number; validatedItems: any[] } {
      if (!menuConfig || !menuConfig.categories || !Array.isArray(orderItems)) {
        return { calculatedTotal: 0, validatedItems: [] };
      }

      const allDishesMap = new Map<string, any>();
      (menuConfig.categories || []).forEach((cat: any) => {
        (cat.dishes || []).forEach((d: any) => {
          if (d.name) allDishesMap.set(d.name.toLowerCase().trim(), d);
        });
      });

      let calculatedTotal = 0;
      const validatedItems = [];

      for (const item of orderItems) {
        const qty = Math.max(1, parseInt(item.quantity) || 1);
        const dishName = (item.name || "").toLowerCase().trim();
        const catalogDish = allDishesMap.get(dishName);

        let unitPrice = 0;

        if (catalogDish) {
          unitPrice = parseFloat(catalogDish.price) || 0;

          // Size override
          if (item.size && Array.isArray(catalogDish.sizes)) {
            const sizeObj = catalogDish.sizes.find((s: any) => (s.name || "").toLowerCase().trim() === (item.size || "").toLowerCase().trim());
            if (sizeObj && sizeObj.price !== undefined) {
              unitPrice = parseFloat(sizeObj.price) || 0;
            }
          }

          // Toppings
          if (Array.isArray(item.toppings) && menuConfig.toppings) {
            const allToppingsMap = new Map<string, number>();
            menuConfig.toppings.forEach((tg: any) => {
              (tg.items || []).forEach((tItem: any) => {
                if (tItem.name) allToppingsMap.set(tItem.name.toLowerCase().trim(), parseFloat(tItem.price) || 0);
              });
            });

            for (const toppingName of item.toppings) {
              const toppingPrice = allToppingsMap.get((toppingName || "").toLowerCase().trim()) || 0;
              unitPrice += toppingPrice;
            }
          }
        } else {
          // Fallback to item price if custom dish, but sanitize to positive float
          unitPrice = Math.max(0, parseFloat(item.price) || 0);
        }

        const itemTotal = unitPrice * qty;
        calculatedTotal += itemTotal;

        validatedItems.push({
          name: item.name || "Item",
          quantity: qty,
          unit_price: unitPrice,
          total: itemTotal
        });
      }

      return { calculatedTotal: Math.round(calculatedTotal * 100) / 100, validatedItems };
    }

    // Action: create_order_checkout_session
    if (action === "create_order_checkout_session") {
      if (!order_id) {
        return new Response(
          JSON.stringify({ error: "Missing 'order_id' parameter" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch Order from Supabase
      const { data: order, error: orderErr } = await supabaseAdmin
        .from("menutech_orders")
        .select("*")
        .eq("id", order_id)
        .single();

      if (orderErr || !order) {
        return new Response(
          JSON.stringify({ error: "Order not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (order.payment_status === "paid") {
        return new Response(
          JSON.stringify({ error: "This order has already been paid" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check restaurant payment config for commission and active status
      const { data: resPayCfg } = await supabaseAdmin
        .from("menutech_restaurant_payment_configs")
        .select("*")
        .eq("user_id", order.user_id)
        .maybeSingle();

      // Ensure online payment service is active or free_access
      const serviceStatus = resPayCfg?.service_status || 'inactive';
      if (!['active', 'free_access'].includes(serviceStatus)) {
        return new Response(
          JSON.stringify({ error: "Online payments are currently inactive or suspended for this restaurant" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Both modes are destination charges: the restaurant must be able to RECEIVE
      // funds. Own Stripe also requires card_payments (fully onboarded account).
      const isCommissionMode = resPayCfg?.payment_mode === "menutech_commission";
      const commissionPct = isCommissionMode ? parseFloat(resPayCfg?.commission_rate || 0) : 0;
      if (isCommissionMode && !(commissionPct > 0 && commissionPct < 100)) {
        return new Response(
          JSON.stringify({ error: "Menutech Commission mode requires a commission rate between 0 and 100" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const receiving = await resolveReceivingAccount(order.user_id);
      // Destination charges only need the connected account to RECEIVE funds; the
      // platform charges the card, so the account's charges_enabled is not required.
      if (!receiving.accountId || !receiving.ready) {
        return new Response(
          JSON.stringify({
            error: "The restaurant has not completed Stripe onboarding to receive online payments",
            code: receiving.reason,
            requirements_due: receiving.requirementsDue
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const stripeAcc = receiving.record;
      const chargeType = "destination";

      // Fetch menu config to validate and recalculate price server-side
      const { data: menu } = await supabaseAdmin
        .from("menutech_menus")
        .select("config")
        .eq("user_id", order.user_id)
        .maybeSingle();

      const rawItems = typeof order.items === "string" ? JSON.parse(order.items) : (order.items || []);
      const { calculatedTotal } = recalculateOrderTotal(menu?.config, rawItems);

      // Validate delivery fee against active delivery zones in database if delivery order
      let deliveryFee = 0;
      if (order.order_type === "delivery") {
        if (order.delivery_zone_name) {
          const { data: zone } = await supabaseAdmin
            .from("menutech_delivery_zones")
            .select("fee")
            .eq("user_id", order.user_id)
            .eq("name", order.delivery_zone_name)
            .eq("is_active", true)
            .maybeSingle();
          if (zone && zone.fee !== undefined) {
            deliveryFee = parseFloat(zone.fee) || 0;
          } else {
            deliveryFee = Math.max(0, parseFloat(order.delivery_fee || 0));
          }
        } else {
          deliveryFee = Math.max(0, parseFloat(order.delivery_fee || 0));
        }
      }

      // Validate promotional discount against database promotions
      let discountAmount = 0;
      if (order.discount_amount && parseFloat(order.discount_amount) > 0) {
        const rawPromo = typeof order.applied_promo === "string" ? JSON.parse(order.applied_promo) : order.applied_promo;
        if (rawPromo && rawPromo.id) {
          const { data: dbPromo } = await supabaseAdmin
            .from("menutech_promotions")
            .select("*")
            .eq("id", rawPromo.id)
            .eq("user_id", order.user_id)
            .eq("is_active", true)
            .maybeSingle();

          if (dbPromo) {
            discountAmount = Math.max(0, parseFloat(order.discount_amount) || 0);
          }
        }
      }

      const productsTotal = calculatedTotal > 0 ? calculatedTotal : Math.max(0, parseFloat(order.subtotal || order.total || order.total_amount || 0));
      const finalAmount = Math.max(0.50, Math.round((productsTotal + deliveryFee - discountAmount) * 100) / 100);
      const currency = ((stripeAcc && stripeAcc.currency) || "usd").toLowerCase();
      const amountInCents = Math.round(finalAmount * 100);

      // Create Stripe Checkout Session
      const params = new URLSearchParams();
      params.append("mode", "payment");
      applyCardOnlyCheckoutOptions(params);
      params.append("line_items[0][price_data][currency]", currency);
      params.append("line_items[0][price_data][product_data][name]", `Order #${order.id.substring(0, 8)} - ${order.customer_name || 'Customer'}${deliveryFee > 0 ? ' (incl. Delivery)' : ''}`);
      params.append("line_items[0][price_data][unit_amount]", amountInCents.toString());
      params.append("line_items[0][quantity]", "1");

      // The customer pays only the order total. The platform pays Stripe's processing
      // fee and recovers it (plus the commission, if any) through application_fee_amount,
      // so the restaurant bears the fee and Menutech keeps the full commission.
      const stripeFeeCents = estimateStripeFeeCents(amountInCents);
      const commissionAmountCents = isCommissionMode
        ? Math.round((amountInCents * commissionPct) / 100)
        : 0;

      params.append("payment_intent_data[transfer_data][destination]", receiving.accountId);
      const applicationFeeCents = stripeFeeCents + commissionAmountCents;
      if (applicationFeeCents > 0 && applicationFeeCents < amountInCents) {
        params.append("payment_intent_data[application_fee_amount]", applicationFeeCents.toString());
      }

      // Session metadata is used by checkout.session.completed. PaymentIntent metadata is
      // required for payment_intent.payment_failed / charge.refunded, which do not inherit
      // the session metadata.
      const metadataEntries: [string, string][] = [
        ["order_id", order.id],
        ["user_id", order.user_id],
        ["type", "order"],
        ["payment_mode", isCommissionMode ? "menutech_commission" : "own_stripe"],
        ["charge_type", chargeType],
        ["commission_rate", commissionPct.toString()],
        ["commission_amount", (commissionAmountCents / 100).toFixed(2)],
        ["stripe_fee_pass_through", (stripeFeeCents / 100).toFixed(2)],
        ["order_total", (amountInCents / 100).toFixed(2)],
        ["charge_total", (amountInCents / 100).toFixed(2)],
        ["destination_account", receiving.accountId]
      ];
      for (const [key, value] of metadataEntries) {
        params.append(`metadata[${key}]`, value);
        params.append(`payment_intent_data[metadata][${key}]`, value);
      }

      // Embedded Checkout: render the Stripe form inline inside the tracking modal
      if (embedded) {
        params.append("ui_mode", "embedded_page");
        // 'if_required' lets card-only payments complete inline and fire the widget's
        // onComplete callback; a redirect only happens if the method strictly requires it.
        params.append("redirect_on_completion", "if_required");
        params.append("return_url", `${baseOrigin}/menu.html?domain=${order.domain || ''}&order_paid=true&order_id=${order.id}&session_id={CHECKOUT_SESSION_ID}`);
      } else {
        params.append("success_url", `${baseOrigin}/menu.html?domain=${order.domain || ''}&order_paid=true&order_id=${order.id}`);
        params.append("cancel_url", `${baseOrigin}/menu.html?domain=${order.domain || ''}&order_canceled=true&order_id=${order.id}`);
      }

      const session = await stripeFetch("/checkout/sessions", {
        method: "POST",
        body: params.toString()
      });

      // Update Order with session ID and pending payment status
      await supabaseAdmin
        .from("menutech_orders")
        .update({
          stripe_checkout_session_id: session.id,
          payment_status: "pending",
          total: finalAmount
        })
        .eq("id", order.id);

      return new Response(
        JSON.stringify({
          url: session.url,
          session_id: session.id,
          client_secret: session.client_secret,
          publishable_key: stripePublishableKey,
          charge_type: chargeType,
          stripe_account_id: null
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Action: create_reservation_checkout_session
    } else if (action === "create_reservation_checkout_session") {
      if (!reservation_id) {
        return new Response(
          JSON.stringify({ error: "Missing 'reservation_id' parameter" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch Reservation
      const { data: resv, error: resvErr } = await supabaseAdmin
        .from("menutech_reservations")
        .select("*")
        .eq("id", reservation_id)
        .single();

      if (resvErr || !resv) {
        return new Response(
          JSON.stringify({ error: "Reservation not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (resv.payment_status === "paid") {
        return new Response(
          JSON.stringify({ error: "This reservation has already been paid" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check restaurant payment config for commission and active status
      const { data: resPayCfg } = await supabaseAdmin
        .from("menutech_restaurant_payment_configs")
        .select("*")
        .eq("user_id", resv.user_id)
        .maybeSingle();

      const serviceStatus = resPayCfg?.service_status || 'inactive';
      if (!['active', 'free_access'].includes(serviceStatus)) {
        return new Response(
          JSON.stringify({ error: "Online payments are currently inactive or suspended for this restaurant" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Same rules as orders: destination charge; Own Stripe also needs card_payments.
      const isCommissionMode = resPayCfg?.payment_mode === "menutech_commission";
      const commissionPct = isCommissionMode ? parseFloat(resPayCfg?.commission_rate || 0) : 0;
      if (isCommissionMode && !(commissionPct > 0 && commissionPct < 100)) {
        return new Response(
          JSON.stringify({ error: "Menutech Commission mode requires a commission rate between 0 and 100" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const receiving = await resolveReceivingAccount(resv.user_id);
      // Destination charges only need the connected account to RECEIVE funds; the
      // platform charges the card, so the account's charges_enabled is not required.
      if (!receiving.accountId || !receiving.ready) {
        return new Response(
          JSON.stringify({
            error: "The restaurant has not completed Stripe onboarding to receive online payments",
            code: receiving.reason,
            requirements_due: receiving.requirementsDue
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const stripeAcc = receiving.record;
      const chargeType = "destination";

      // Recalculate pre-order items total from menu
      const { data: menu } = await supabaseAdmin
        .from("menutech_menus")
        .select("config")
        .eq("user_id", resv.user_id)
        .maybeSingle();

      const rawPreorder = typeof resv.preorder_items === "string" ? JSON.parse(resv.preorder_items) : (resv.preorder_items || []);
      const { calculatedTotal } = recalculateOrderTotal(menu?.config, rawPreorder);

      const finalAmount = calculatedTotal > 0 ? calculatedTotal : Math.max(1, parseFloat(resv.preorder_total || 0));

      if (finalAmount <= 0) {
        return new Response(
          JSON.stringify({ error: "No payment amount due for this reservation" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const currency = ((stripeAcc && stripeAcc.currency) || "usd").toLowerCase();
      const amountInCents = Math.round(finalAmount * 100);

      const params = new URLSearchParams();
      params.append("mode", "payment");
      applyCardOnlyCheckoutOptions(params);
      params.append("line_items[0][price_data][currency]", currency);
      params.append("line_items[0][price_data][product_data][name]", `Table Reservation Pre-order - ${resv.customer_name}`);
      params.append("line_items[0][price_data][unit_amount]", amountInCents.toString());
      params.append("line_items[0][quantity]", "1");

      // Customer pays only the order total; the restaurant bears Stripe's fee.
      const stripeFeeCents = estimateStripeFeeCents(amountInCents);
      const commissionAmountCents = isCommissionMode
        ? Math.round((amountInCents * commissionPct) / 100)
        : 0;

      params.append("payment_intent_data[transfer_data][destination]", receiving.accountId);
      const applicationFeeCents = stripeFeeCents + commissionAmountCents;
      if (applicationFeeCents > 0 && applicationFeeCents < amountInCents) {
        params.append("payment_intent_data[application_fee_amount]", applicationFeeCents.toString());
      }

      const metadataEntries: [string, string][] = [
        ["reservation_id", resv.id],
        ["user_id", resv.user_id],
        ["type", "reservation"],
        ["payment_mode", isCommissionMode ? "menutech_commission" : "own_stripe"],
        ["charge_type", chargeType],
        ["commission_rate", commissionPct.toString()],
        ["commission_amount", (commissionAmountCents / 100).toFixed(2)],
        ["stripe_fee_pass_through", (stripeFeeCents / 100).toFixed(2)],
        ["order_total", (amountInCents / 100).toFixed(2)],
        ["charge_total", (amountInCents / 100).toFixed(2)],
        ["destination_account", receiving.accountId]
      ];
      for (const [key, value] of metadataEntries) {
        params.append(`metadata[${key}]`, value);
        params.append(`payment_intent_data[metadata][${key}]`, value);
      }

      params.append("success_url", `${baseOrigin}/menu.html?domain=${resv.domain || ''}&res_paid=true&res_id=${resv.id}`);
      params.append("cancel_url", `${baseOrigin}/menu.html?domain=${resv.domain || ''}&res_canceled=true&res_id=${resv.id}`);

      const session = await stripeFetch("/checkout/sessions", {
        method: "POST",
        body: params.toString()
      });

      await supabaseAdmin
        .from("menutech_reservations")
        .update({
          stripe_checkout_session_id: session.id,
          payment_status: "pending"
        })
        .eq("id", resv.id);

      return new Response(
        JSON.stringify({
          url: session.url,
          session_id: session.id,
          client_secret: session.client_secret,
          publishable_key: stripePublishableKey,
          charge_type: chargeType,
          stripe_account_id: null
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Action: create_subscription_checkout_session (Restaurant subscribes to Online Payments monthly service)
    } else if (action === "create_subscription_checkout_session") {
      // Verify JWT auth
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Missing Authorization header" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);

      if (authErr || !user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized user session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const effectiveTargetId = target_user_id || user.id;

      // Fetch pricing from restaurant config or fallback to global config
      const { data: resCfg } = await supabaseAdmin
        .from("menutech_restaurant_payment_configs")
        .select("monthly_price")
        .eq("user_id", effectiveTargetId)
        .maybeSingle();

      let price = resCfg ? parseFloat(resCfg.monthly_price) : 29.00;
      if (!price || price <= 0) {
        const { data: globCfg } = await supabaseAdmin
          .from("menutech_online_payment_global_config")
          .select("monthly_price")
          .limit(1)
          .maybeSingle();
        price = globCfg ? parseFloat(globCfg.monthly_price) : 29.00;
      }

      const amountCents = Math.round(price * 100);

      // Create Stripe Checkout Session (Platform direct payment)
      const params = new URLSearchParams();
      params.append("mode", "payment");
      params.append("line_items[0][price_data][currency]", "usd");
      params.append("line_items[0][price_data][product_data][name]", "Menutech Online Payments - Monthly Subscription");
      params.append("line_items[0][price_data][product_data][description]", "Monthly access to Menutech Online Payment processing service.");
      params.append("line_items[0][price_data][unit_amount]", amountCents.toString());
      params.append("line_items[0][quantity]", "1");

      params.append("metadata[target_user_id]", effectiveTargetId);
      params.append("metadata[type]", "online_payment_subscription");

      params.append("success_url", `${baseOrigin}/onlinePayment.html?sub_success=true`);
      params.append("cancel_url", `${baseOrigin}/onlinePayment.html?sub_canceled=true`);

      const session = await stripeFetch("/checkout/sessions", {
        method: "POST",
        body: params.toString()
      });

      return new Response(
        JSON.stringify({ url: session.url, session_id: session.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Action: get_stripe_config (returns the public publishable key for embedded Stripe.js)
    } else if (action === "get_stripe_config") {
      return new Response(
        JSON.stringify({ publishable_key: stripePublishableKey }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Action: get_checkout_session (lets the widget reuse an open embedded session on reopen)
    } else if (action === "get_checkout_session") {
      const sessionId = payload.session_id;
      if (!sessionId) {
        return new Response(
          JSON.stringify({ error: "Missing 'session_id' parameter" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const session = await stripeFetch(`/checkout/sessions/${sessionId}`);

      return new Response(
        JSON.stringify({
          status: session.status,
          client_secret: session.client_secret || null,
          payment_status: session.payment_status || null,
          publishable_key: stripePublishableKey,
          charge_type: session.metadata?.charge_type || "destination",
          stripe_account_id: null
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Action: confirm_order_payment (verify the session was paid and settle the order immediately,
    // without waiting for the webhook, so the tracking UI reflects payment right away)
    } else if (action === "confirm_order_payment") {
      if (!order_id) {
        return new Response(
          JSON.stringify({ error: "Missing 'order_id' parameter" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: order } = await supabaseAdmin
        .from("menutech_orders")
        .select("*")
        .eq("id", order_id)
        .maybeSingle();

      if (!order) {
        return new Response(
          JSON.stringify({ error: "Order not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (order.payment_status === "paid") {
        return new Response(
          JSON.stringify({ paid: true, status: order.status }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!order.stripe_checkout_session_id) {
        return new Response(
          JSON.stringify({ paid: false, reason: "no_session" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let session: any = null;
      try {
        session = await stripeFetch(`/checkout/sessions/${order.stripe_checkout_session_id}`);
      } catch (e) {
        return new Response(
          JSON.stringify({ paid: false, reason: "session_lookup_failed" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (session && session.payment_status === "paid") {
        const orderUpdates: Record<string, any> = {
          payment_status: "paid",
          payment_method: "online",
          stripe_payment_intent_id: session.payment_intent || null,
          stripe_checkout_session_id: session.id
        };
        if (order.status === "accepted") {
          orderUpdates.status = "preparing";
          orderUpdates.preparing_at = new Date().toISOString();
        }
        await supabaseAdmin.from("menutech_orders").update(orderUpdates).eq("id", order.id);
        return new Response(
          JSON.stringify({ paid: true, status: orderUpdates.status || order.status }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ paid: false, reason: "unpaid" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Action: cancel_order_payment (customer cancels or the 10-minute window expires).
    // Runs with the service role so it works regardless of the table's RLS policies,
    // and expires the Stripe session so no charge can happen afterwards.
    } else if (action === "cancel_order_payment") {
      if (!order_id) {
        return new Response(
          JSON.stringify({ error: "Missing 'order_id' parameter" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: order } = await supabaseAdmin
        .from("menutech_orders")
        .select("*")
        .eq("id", order_id)
        .maybeSingle();

      if (!order) {
        return new Response(
          JSON.stringify({ error: "Order not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (order.payment_status === "paid") {
        return new Response(
          JSON.stringify({ cancelled: false, reason: "already_paid" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Only ever cancel an online order that is still awaiting payment.
      if (order.payment_method !== "online" || !["pending", "accepted"].includes(order.status)) {
        return new Response(
          JSON.stringify({ cancelled: false, reason: "not_cancellable" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (order.stripe_checkout_session_id) {
        try {
          await stripeFetch(`/checkout/sessions/${order.stripe_checkout_session_id}/expire`, { method: "POST" });
        } catch (e) {
          // Session may already be expired or completed; ignore and continue cancelling.
        }
      }

      await supabaseAdmin.from("menutech_orders").update({
        status: "cancelled",
        rejection_reason: payload.reason || "Payment not completed"
      }).eq("id", order.id);

      return new Response(
        JSON.stringify({ cancelled: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else {
      return new Response(
        JSON.stringify({ error: `Invalid action '${action}'` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (err: any) {
    console.error("stripe-payment Edge Function Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
