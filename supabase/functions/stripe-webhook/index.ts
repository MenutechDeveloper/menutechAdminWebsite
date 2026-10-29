// Supabase Edge Function: stripe-webhook
// Validates Stripe webhook signatures and updates orders, reservations, and payment logs idempotently.
// Required Secrets: stripe_webhook_secret (or STRIPE_WEBHOOK_SECRET), stripe_api

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Web Crypto HMAC-SHA256 signature verification for Stripe Webhooks
async function verifyStripeSignature(rawBody: string, signatureHeader: string, webhookSecret: string): Promise<boolean> {
  try {
    const items = signatureHeader.split(",").reduce((acc: any, item: string) => {
      const [key, value] = item.trim().split("=");
      if (key && value) acc[key] = value;
      return acc;
    }, {});

    const timestamp = items["t"];
    const expectedSignature = items["v1"];

    if (!timestamp || !expectedSignature) return false;

    const signedPayload = `${timestamp}.${rawBody}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signedPayload)
    );

    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const calculatedSignature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    return calculatedSignature === expectedSignature;
  } catch (err) {
    console.error("Signature verification exception:", err);
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const webhookSecret = (
      Deno.env.get("stripe_webhook_secret") ||
      Deno.env.get("STRIPE_WEBHOOK_SECRET") ||
      ""
    ).trim();

    const rawBody = await req.text();
    const signatureHeader = req.headers.get("stripe-signature") || "";

    // If webhook secret is configured, strictly enforce signature verification
    if (webhookSecret) {
      const isValid = await verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
      if (!isValid) {
        console.error("Invalid Stripe Webhook Signature");
        return new Response(
          JSON.stringify({ error: "Invalid webhook signature" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      console.warn("STRIPE_WEBHOOK_SECRET is not configured in Supabase Secrets. Proceeding with event parsing (development fallback).");
    }

    const event = JSON.parse(rawBody);
    const eventId = event.id;
    const eventType = event.type;
    const eventData = event.data?.object || {};

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Idempotency Check
    if (eventId) {
      const { data: existingLog } = await supabaseAdmin
        .from("menutech_payment_logs")
        .select("id")
        .eq("stripe_event_id", eventId)
        .maybeSingle();

      if (existingLog) {
        console.log(`Event ${eventId} already processed. Returning 200 OK.`);
        return new Response(
          JSON.stringify({ received: true, idempotent: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log(`Processing Stripe Event: ${eventType} (${eventId})`);

    // Handle Event Types
    if (eventType === "checkout.session.completed") {
      const session = eventData;
      const metadata = session.metadata || {};
      const orderId = metadata.order_id;
      const reservationId = metadata.reservation_id;
      const userId = metadata.user_id || session.client_reference_id || "";
      const paymentIntentId = session.payment_intent || "";
      const amountTotal = (session.amount_total || 0) / 100;
      const currency = session.currency || "usd";

      if (orderId) {
        await supabaseAdmin
          .from("menutech_orders")
          .update({
            payment_status: "paid",
            stripe_payment_intent_id: paymentIntentId,
            stripe_checkout_session_id: session.id
          })
          .eq("id", orderId);

        console.log(`Order ${orderId} marked as PAID.`);
      }

      if (reservationId) {
        await supabaseAdmin
          .from("menutech_reservations")
          .update({
            payment_status: "paid",
            stripe_payment_intent_id: paymentIntentId,
            stripe_checkout_session_id: session.id
          })
          .eq("id", reservationId);

        console.log(`Reservation ${reservationId} marked as PAID.`);
      }

      // Record Audit Log
      await supabaseAdmin.from("menutech_payment_logs").insert({
        user_id: userId || "00000000-0000-0000-0000-000000000000",
        stripe_account_id: session.transfer_data?.destination || null,
        order_id: orderId || null,
        reservation_id: reservationId || null,
        event_type: eventType,
        stripe_event_id: eventId,
        amount: amountTotal,
        currency: currency,
        status: "succeeded",
        payload: eventData
      });

    } else if (eventType === "checkout.session.expired") {
      const session = eventData;
      const metadata = session.metadata || {};
      const orderId = metadata.order_id;
      const reservationId = metadata.reservation_id;

      if (orderId) {
        await supabaseAdmin.from("menutech_orders").update({ payment_status: "expired" }).eq("id", orderId);
      }
      if (reservationId) {
        await supabaseAdmin.from("menutech_reservations").update({ payment_status: "expired" }).eq("id", reservationId);
      }

      await supabaseAdmin.from("menutech_payment_logs").insert({
        user_id: metadata.user_id || "00000000-0000-0000-0000-000000000000",
        order_id: orderId || null,
        reservation_id: reservationId || null,
        event_type: eventType,
        stripe_event_id: eventId,
        status: "expired",
        payload: eventData
      });

    } else if (eventType === "payment_intent.payment_failed") {
      const paymentIntent = eventData;
      const metadata = paymentIntent.metadata || {};
      const orderId = metadata.order_id;
      const reservationId = metadata.reservation_id;

      if (orderId) {
        await supabaseAdmin.from("menutech_orders").update({ payment_status: "failed" }).eq("id", orderId);
      }
      if (reservationId) {
        await supabaseAdmin.from("menutech_reservations").update({ payment_status: "failed" }).eq("id", reservationId);
      }

      await supabaseAdmin.from("menutech_payment_logs").insert({
        user_id: metadata.user_id || "00000000-0000-0000-0000-000000000000",
        order_id: orderId || null,
        reservation_id: reservationId || null,
        event_type: eventType,
        stripe_event_id: eventId,
        status: "failed",
        payload: eventData
      });

    } else if (eventType === "account.updated") {
      const account = eventData;
      const stripeAccountId = account.id;

      if (stripeAccountId) {
        await supabaseAdmin
          .from("menutech_stripe_accounts")
          .update({
            details_submitted: account.details_submitted || false,
            charges_enabled: account.charges_enabled || false,
            payouts_enabled: account.payouts_enabled || false,
            updated_at: new Date().toISOString()
          })
          .eq("stripe_account_id", stripeAccountId);

        console.log(`Updated Stripe account ${stripeAccountId} capabilities.`);
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("stripe-webhook Edge Function Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Webhook processing error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
