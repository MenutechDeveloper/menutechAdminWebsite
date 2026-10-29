// Supabase Edge Function: stripe-payment
// Creates Stripe Checkout sessions for orders and reservations with server-side price validation and Destination Charges.
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
      Deno.env.get("STRIPE_API_KEY") ||
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
    const { action, order_id, reservation_id, origin_url } = payload;

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

      // Verify connected Stripe account
      const { data: stripeAcc } = await supabaseAdmin
        .from("menutech_stripe_accounts")
        .select("*")
        .eq("user_id", order.user_id)
        .maybeSingle();

      if (!stripeAcc || !stripeAcc.stripe_account_id || !stripeAcc.charges_enabled) {
        return new Response(
          JSON.stringify({ error: "The restaurant has not connected a valid Stripe account for online payments" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch menu config to validate and recalculate price
      const { data: menu } = await supabaseAdmin
        .from("menutech_menus")
        .select("config")
        .eq("user_id", order.user_id)
        .maybeSingle();

      const rawItems = typeof order.items === "string" ? JSON.parse(order.items) : (order.items || []);
      const { calculatedTotal } = recalculateOrderTotal(menu?.config, rawItems);

      const finalAmount = calculatedTotal > 0 ? calculatedTotal : Math.max(1, parseFloat(order.total || order.total_amount || 0));
      const currency = (stripeAcc.currency || "usd").toLowerCase();
      const amountInCents = Math.round(finalAmount * 100);

      // Create Stripe Checkout Session
      const params = new URLSearchParams();
      params.append("mode", "payment");
      params.append("payment_method_types[0]", "card");
      params.append("line_items[0][price_data][currency]", currency);
      params.append("line_items[0][price_data][product_data][name]", `Order #${order.id.substring(0, 8)} - ${order.customer_name || 'Customer'}`);
      params.append("line_items[0][price_data][unit_amount]", amountInCents.toString());
      params.append("line_items[0][quantity]", "1");

      // Destination Charge: money flows directly to restaurant's connected account
      params.append("transfer_data[destination]", stripeAcc.stripe_account_id);

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

      // Verify Connected Account
      const { data: stripeAcc } = await supabaseAdmin
        .from("menutech_stripe_accounts")
        .select("*")
        .eq("user_id", resv.user_id)
        .maybeSingle();

      if (!stripeAcc || !stripeAcc.stripe_account_id || !stripeAcc.charges_enabled) {
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

      const currency = (stripeAcc.currency || "usd").toLowerCase();
      const amountInCents = Math.round(finalAmount * 100);

      const params = new URLSearchParams();
      params.append("mode", "payment");
      params.append("payment_method_types[0]", "card");
      params.append("line_items[0][price_data][currency]", currency);
      params.append("line_items[0][price_data][product_data][name]", `Table Reservation Pre-order - ${resv.customer_name}`);
      params.append("line_items[0][price_data][unit_amount]", amountInCents.toString());
      params.append("line_items[0][quantity]", "1");

      params.append("transfer_data[destination]", stripeAcc.stripe_account_id);
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
