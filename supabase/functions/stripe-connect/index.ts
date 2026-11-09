// Supabase Edge Function: stripe-connect
// Handles Stripe Connect account creation, manual account ID linking, onboarding links, status updates, Express login links, and admin payment config updates.
// Secret required: stripe_api

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
    const { action, target_user_id, stripe_account_id, payment_config } = payload;

    // Check caller role
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const callerRole = (callerProfile?.role || "").toUpperCase();
    const isPrivileged = ["ADMIN", "DEVELOPER", "CS", "ADMINCS"].includes(callerRole);

    // Caller can manage their own user_id, or if target_user_id is specified, must be admin
    let effectiveUserId = user.id;
    if (target_user_id && target_user_id !== user.id) {
      if (!isPrivileged) {
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

    // Action 1: create_onboarding_link
    if (action === "create_onboarding_link") {
      // Check existing record
      const { data: existingAccount } = await supabaseAdmin
        .from("menutech_stripe_accounts")
        .select("*")
        .eq("user_id", effectiveUserId)
        .maybeSingle();

      let currentAccountId = existingAccount?.stripe_account_id;

      if (!currentAccountId) {
        // Fetch user email & profile for Stripe account prefill
        const { data: targetUserData } = await supabaseAdmin.auth.admin.getUserById(effectiveUserId);
        const email = targetUserData?.user?.email || "";

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("username, domain")
          .eq("id", effectiveUserId)
          .maybeSingle();

        const businessName = profile?.username || profile?.domain || "Menutech Restaurant";

        const params = new URLSearchParams();
        params.append("type", "express");
        if (email) params.append("email", email);
        params.append("business_profile[name]", businessName);
        params.append("capabilities[card_payments][requested]", "true");
        params.append("capabilities[transfers][requested]", "true");

        const newAccount = await stripeFetch("/accounts", {
          method: "POST",
          body: params.toString()
        });

        currentAccountId = newAccount.id;

        // Upsert into Supabase
        await supabaseAdmin.from("menutech_stripe_accounts").upsert({
          user_id: effectiveUserId,
          stripe_account_id: currentAccountId,
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
      linkParams.append("account", currentAccountId);
      linkParams.append("refresh_url", refreshUrl);
      linkParams.append("return_url", returnUrl);
      linkParams.append("type", "account_onboarding");

      const linkRes = await stripeFetch("/account_links", {
        method: "POST",
        body: linkParams.toString()
      });

      return new Response(
        JSON.stringify({ url: linkRes.url, account_id: currentAccountId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Action 2: get_account_status
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

      let stripeAccount: any = null;
      try {
        stripeAccount = await stripeFetch(`/accounts/${existingAccount.stripe_account_id}`);
      } catch (err: any) {
        console.warn("Error fetching account from Stripe API:", err.message);
      }

      const updatedRecord = {
        user_id: effectiveUserId,
        stripe_account_id: existingAccount.stripe_account_id,
        details_submitted: stripeAccount ? (stripeAccount.details_submitted || false) : (existingAccount.details_submitted || false),
        charges_enabled: stripeAccount ? (stripeAccount.charges_enabled || false) : (existingAccount.charges_enabled || false),
        payouts_enabled: stripeAccount ? (stripeAccount.payouts_enabled || false) : (existingAccount.payouts_enabled || false),
        country: stripeAccount?.country || existingAccount.country || "US",
        currency: stripeAccount?.default_currency || existingAccount.currency || "usd",
        updated_at: new Date().toISOString()
      };

      await supabaseAdmin.from("menutech_stripe_accounts").upsert(updatedRecord, { onConflict: "user_id" });

      return new Response(
        JSON.stringify({ account: updatedRecord }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Action 4: create_login_link
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

    // Action 5: disconnect_account
    } else if (action === "disconnect_account") {
      if (!isPrivileged && effectiveUserId !== user.id) {
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabaseAdmin.from("menutech_stripe_accounts").delete().eq("user_id", effectiveUserId);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Action 5: update_payment_config (Admin updates payment mode, commissions, service status, due dates with audit trail)
    } else if (action === "update_payment_config") {
      if (!isPrivileged) {
        return new Response(
          JSON.stringify({ error: "Forbidden: Only administrators can modify payment configurations" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!payment_config || typeof payment_config !== "object") {
        return new Response(
          JSON.stringify({ error: "Missing 'payment_config' object" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const updateData: any = {
        user_id: effectiveUserId,
        updated_at: new Date().toISOString()
      };

      if (payment_config.service_status !== undefined) updateData.service_status = payment_config.service_status;
      if (payment_config.payment_mode !== undefined) updateData.payment_mode = payment_config.payment_mode;
      if (payment_config.commission_rate !== undefined) updateData.commission_rate = parseFloat(payment_config.commission_rate) || 0;
      if (payment_config.monthly_price !== undefined) updateData.monthly_price = parseFloat(payment_config.monthly_price) || 29.00;
      if (payment_config.is_free_access !== undefined) updateData.is_free_access = Boolean(payment_config.is_free_access);
      if (payment_config.next_due_date !== undefined) updateData.next_due_date = payment_config.next_due_date;
      if (payment_config.service_start_date !== undefined) updateData.service_start_date = payment_config.service_start_date;
      if (payment_config.commission_authorized_at !== undefined) updateData.commission_authorized_at = payment_config.commission_authorized_at;
      if (payment_config.commission_authorized_by !== undefined) updateData.commission_authorized_by = payment_config.commission_authorized_by;
      if (payment_config.commission_revoked_at !== undefined) updateData.commission_revoked_at = payment_config.commission_revoked_at;

      // Ensure modalities are strictly mutually exclusive: if own_stripe is authorized, commission_rate is reset to 0
      if (payment_config.payment_mode === "own_stripe") {
        updateData.commission_rate = 0.00;
      }

      const { data: savedConfig, error: saveErr } = await supabaseAdmin
        .from("menutech_restaurant_payment_configs")
        .upsert(updateData, { onConflict: "user_id" })
        .select()
        .single();

      if (saveErr) {
        throw new Error(saveErr.message);
      }

      return new Response(
        JSON.stringify({ success: true, config: savedConfig }),
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
