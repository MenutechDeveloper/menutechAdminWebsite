// Supabase Edge Function: stripe-connect
// Handles Stripe Connect account creation, onboarding links, status updates, and Express login links.
// Secrets required: stripe_api (or STRIPE_API_KEY)

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

    // Verify JWT Authorization
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

    const payload = await req.json().catch(() => ({}));
    const { action, target_user_id } = payload;

    // Caller can manage their own user_id, or if target_user_id is specified, check admin role
    let effectiveUserId = user.id;
    if (target_user_id && target_user_id !== user.id) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      const role = (profile?.role || "").toUpperCase();
      if (!["ADMIN", "DEVELOPER", "CS", "ADMINCS"].includes(role)) {
        return new Response(
          JSON.stringify({ error: "Forbidden: Cannot modify another user's Stripe account" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      effectiveUserId = target_user_id;
    }

    // Helper for Stripe REST API calls using URLSearchParams / Fetch
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

    // Handle Action: create_onboarding_link
    if (action === "create_onboarding_link") {
      // Check existing record
      const { data: existingAccount } = await supabaseAdmin
        .from("menutech_stripe_accounts")
        .select("*")
        .eq("user_id", effectiveUserId)
        .maybeSingle();

      let stripeAccountId = existingAccount?.stripe_account_id;

      if (!stripeAccountId) {
        // Fetch user email for Stripe account prefill
        const { data: targetUserData } = await supabaseAdmin.auth.admin.getUserById(effectiveUserId);
        const email = targetUserData?.user?.email || "";

        const params = new URLSearchParams();
        params.append("type", "express");
        if (email) params.append("email", email);
        params.append("capabilities[card_payments][requested]", "true");
        params.append("capabilities[transfers][requested]", "true");

        const newAccount = await stripeFetch("/accounts", {
          method: "POST",
          body: params.toString()
        });

        stripeAccountId = newAccount.id;

        // Upsert into Supabase
        await supabaseAdmin.from("menutech_stripe_accounts").upsert({
          user_id: effectiveUserId,
          stripe_account_id: stripeAccountId,
          details_submitted: newAccount.details_submitted || false,
          charges_enabled: newAccount.charges_enabled || false,
          payouts_enabled: newAccount.payouts_enabled || false,
          country: newAccount.country || "US",
          currency: newAccount.default_currency || "usd",
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" });
      }

      // Origin for return/refresh URLs
      const reqOrigin = req.headers.get("origin") || "https://menutech.io";
      const refreshUrl = `${reqOrigin}/onlinePayment.html?stripe_refresh=true`;
      const returnUrl = `${reqOrigin}/onlinePayment.html?stripe_return=true`;

      const linkParams = new URLSearchParams();
      linkParams.append("account", stripeAccountId);
      linkParams.append("refresh_url", refreshUrl);
      linkParams.append("return_url", returnUrl);
      linkParams.append("type", "account_onboarding");

      const linkRes = await stripeFetch("/account_links", {
        method: "POST",
        body: linkParams.toString()
      });

      return new Response(
        JSON.stringify({ url: linkRes.url, account_id: stripeAccountId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "get_account_status") {
      const { data: existingAccount } = await supabaseAdmin
        .from("menutech_stripe_accounts")
        .select("*")
        .eq("user_id", effectiveUserId)
        .maybeSingle();

      if (!existingAccount || !existingAccount.stripe_account_id) {
        return new Response(
          JSON.stringify({ not_connected: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const stripeAccount = await stripeFetch(`/accounts/${existingAccount.stripe_account_id}`);

      const updatedRecord = {
        user_id: effectiveUserId,
        stripe_account_id: existingAccount.stripe_account_id,
        details_submitted: stripeAccount.details_submitted || false,
        charges_enabled: stripeAccount.charges_enabled || false,
        payouts_enabled: stripeAccount.payouts_enabled || false,
        country: stripeAccount.country || existingAccount.country || "US",
        currency: stripeAccount.default_currency || existingAccount.currency || "usd",
        updated_at: new Date().toISOString()
      };

      await supabaseAdmin.from("menutech_stripe_accounts").upsert(updatedRecord, { onConflict: "user_id" });

      return new Response(
        JSON.stringify({ account: updatedRecord }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "create_login_link") {
      const { data: existingAccount } = await supabaseAdmin
        .from("menutech_stripe_accounts")
        .select("stripe_account_id")
        .eq("user_id", effectiveUserId)
        .single();

      if (!existingAccount?.stripe_account_id) {
        return new Response(
          JSON.stringify({ error: "No connected Stripe account found" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const loginLink = await stripeFetch(`/accounts/${existingAccount.stripe_account_id}/login_links`, {
        method: "POST"
      });

      return new Response(
        JSON.stringify({ url: loginLink.url }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "disconnect_account") {
      await supabaseAdmin.from("menutech_stripe_accounts").delete().eq("user_id", effectiveUserId);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else {
      return new Response(
        JSON.stringify({ error: `Invalid action '${action}'` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (err: any) {
    console.error("stripe-connect Edge Function Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
