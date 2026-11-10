// Supabase Edge Function: stripe-payment
// Creates Stripe Checkout sessions for orders and reservations with server-side price validation,
// supports destination charges and application fee commissions (Menutech Commission mode),
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

    const payload = await req.json().catch(() => ({}));
    const { action, order_id, reservation_id, target_user_id, origin_url } = payload;

    const baseOrigin = origin_url || req.headers.get("origin") || "https://menutech.io";

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

      // Verify connected Stripe account
      const { data: stripeAcc } = await supabaseAdmin
        .from("menutech_stripe_accounts")
        .select("*")
        .eq("user_id", order.user_id)
        .maybeSingle();

      const isCommissionMode = resPayCfg?.payment_mode === "menutech_commission";
      if (!isCommissionMode && (!stripeAcc || !stripeAcc.stripe_account_id || !stripeAcc.charges_enabled)) {
        return new Response(
          JSON.stringify({ error: "The restaurant has not connected a valid Stripe account for online payments" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
      params.append("payment_method_types[0]", "card");
      params.append("line_items[0][price_data][currency]", currency);
      params.append("line_items[0][price_data][product_data][name]", `Order #${order.id.substring(0, 8)} - ${order.customer_name || 'Customer'}${deliveryFee > 0 ? ' (incl. Delivery)' : ''}`);
      params.append("line_items[0][price_data][unit_amount]", amountInCents.toString());
      params.append("line_items[0][quantity]", "1");

      // Destination Charge if connected account available
      if (stripeAcc && stripeAcc.stripe_account_id && stripeAcc.charges_enabled) {
        params.append("transfer_data[destination]", stripeAcc.stripe_account_id);

        // If Menutech Commission mode is active and commission rate is configured, apply application fee
        if (resPayCfg && resPayCfg.payment_mode === "menutech_commission" && parseFloat(resPayCfg.commission_rate || 0) > 0) {
          const commissionPct = parseFloat(resPayCfg.commission_rate);
          const commissionAmountCents = Math.round((amountInCents * commissionPct) / 100);
          if (commissionAmountCents > 0 && commissionAmountCents < amountInCents) {
            params.append("payment_intent_data[application_fee_amount]", commissionAmountCents.toString());
          }
        }
      }

      // Metadata for webhook correlation
      params.append("metadata[order_id]", order.id);
      params.append("metadata[user_id]", order.user_id);
      params.append("metadata[type]", "order");

      params.append("success_url", `${baseOrigin}/menu.html?domain=${order.domain || ''}&order_paid=true&order_id=${order.id}`);
      params.append("cancel_url", `${baseOrigin}/menu.html?domain=${order.domain || ''}&order_canceled=true&order_id=${order.id}`);

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
        JSON.stringify({ url: session.url, session_id: session.id }),
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

      // Verify Connected Account
      const { data: stripeAcc } = await supabaseAdmin
        .from("menutech_stripe_accounts")
        .select("*")
        .eq("user_id", resv.user_id)
        .maybeSingle();

      const isCommissionMode = resPayCfg?.payment_mode === "menutech_commission";
      if (!isCommissionMode && (!stripeAcc || !stripeAcc.stripe_account_id || !stripeAcc.charges_enabled)) {
        return new Response(
          JSON.stringify({ error: "The restaurant has not connected a valid Stripe account for online payments" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
      params.append("payment_method_types[0]", "card");
      params.append("line_items[0][price_data][currency]", currency);
      params.append("line_items[0][price_data][product_data][name]", `Table Reservation Pre-order - ${resv.customer_name}`);
      params.append("line_items[0][price_data][unit_amount]", amountInCents.toString());
      params.append("line_items[0][quantity]", "1");

      // Destination Charge if connected account available
      if (stripeAcc && stripeAcc.stripe_account_id && stripeAcc.charges_enabled) {
        params.append("transfer_data[destination]", stripeAcc.stripe_account_id);

        if (resPayCfg && resPayCfg.payment_mode === "menutech_commission" && parseFloat(resPayCfg.commission_rate || 0) > 0) {
          const commissionPct = parseFloat(resPayCfg.commission_rate);
          const commissionAmountCents = Math.round((amountInCents * commissionPct) / 100);
          if (commissionAmountCents > 0 && commissionAmountCents < amountInCents) {
            params.append("payment_intent_data[application_fee_amount]", commissionAmountCents.toString());
          }
        }
      }

      params.append("metadata[reservation_id]", resv.id);
      params.append("metadata[user_id]", resv.user_id);
      params.append("metadata[type]", "reservation");

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
        JSON.stringify({ url: session.url, session_id: session.id }),
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
      params.append("payment_method_types[0]", "card");
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
