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
      Deno.env.get("STRIPE_API_KEY") ||
      Deno.env.get("STRIPE_SECRET_KEY") ||
      ""
    ).trim();

    if (!stripeApiKey) {
      return new Response(
        JSON.stringify({ error: "Secret 'stripe_api' no encontrada en Supabase. Configura el secret 'stripe_api' en Supabase Secrets." }),
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
    const isPrivileged = ["ADMIN", "SUPERADMIN", "DEVELOPER", "CS", "ADMINCS"].includes(callerRole);

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

    // API v2 uses JSON encoding and requires the Stripe-Version header.
    // Account creation must use POST /v2/core/accounts: Stripe no longer allows
    // creating Accounts through the v1 API for new Connect integrations.
    const STRIPE_API_VERSION = Deno.env.get("STRIPE_API_VERSION") || "2026-10-28.endive";

    async function stripeFetchV2(endpoint: string, options: any = {}) {
      const url = `https://api.stripe.com/v2${endpoint}`;
      const headers = {
        "Authorization": `Bearer ${stripeApiKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
        "Content-Type": "application/json",
        ...options.headers
      };

      const res = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || `Stripe API error: ${res.status}`);
      }
      return data;
    }

    // Maps an Accounts v2 object to the flat row shape stored in menutech_stripe_accounts
    // (which mirrors the old v1 Account fields used across the UI and webhook).
    function mapV2AccountToRecord(account: any) {
      const merchantCaps = account?.configuration?.merchant?.capabilities || {};
      const recipientCaps = account?.configuration?.recipient?.capabilities || {};
      // v2 exposes outstanding requirements as `entries` (v1 used currently_due/past_due).
      const pendingEntries = account?.requirements?.entries || [];
      const hasOpenRequirements = pendingEntries.some(
        (e: any) => e?.awaiting_action_from === "user"
      );
      // Payouts live under the merchant config in v2; recipients get transfers.
      const canReceive =
        merchantCaps?.stripe_balance?.payouts?.status === "active" ||
        recipientCaps?.stripe_balance?.stripe_transfers?.status === "active";
      return {
        stripe_account_id: account.id,
        charges_enabled: merchantCaps?.card_payments?.status === "active",
        payouts_enabled: canReceive,
        details_submitted: !hasOpenRequirements,
        country: (account?.identity?.country || "US").toUpperCase(),
        currency: account?.defaults?.currency || "usd",
        updated_at: new Date().toISOString()
      };
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

        // Create the connected account with Accounts v2 (Stripe no longer allows
        // creating Accounts through the v1 API for new Connect integrations).
        // The merchant configuration lets the account accept card payments; the
        // recipient configuration lets it receive transfers (destination charges).
        // dashboard=express mirrors the previous Express onboarding experience.
        const newAccount = await stripeFetchV2("/core/accounts", {
          method: "POST",
          body: {
            contact_email: email || undefined,
            display_name: businessName,
            dashboard: "express",
            identity: {
              country: "us"
            },
            configuration: {
              merchant: {
                capabilities: {
                  card_payments: { requested: true }
                }
              },
              recipient: {
                capabilities: {
                  stripe_balance: {
                    stripe_transfers: { requested: true }
                  }
                }
              }
            },
            defaults: {
              currency: "usd",
              responsibilities: {
                fees_collector: "application",
                losses_collector: "application"
              },
              locales: ["en-US"]
            },
            include: [
              "configuration.merchant",
              "configuration.recipient",
              "identity",
              "requirements"
            ]
          }
        });

        currentAccountId = newAccount.id;

        // Upsert into Supabase
        await supabaseAdmin.from("menutech_stripe_accounts").upsert({
          user_id: effectiveUserId,
          ...mapV2AccountToRecord(newAccount)
        }, { onConflict: "user_id" });
      }

      // Origin for return/refresh URLs.
      // Include the restaurant id: an admin returning from Stripe would otherwise land on
      // the first restaurant in the sidebar and never see this account's fresh status.
      const reqOrigin = req.headers.get("origin") || "https://menutech.io";
      const ownerParam = `owner_id=${encodeURIComponent(effectiveUserId)}`;
      const refreshUrl = `${reqOrigin}/onlinePayment.html?stripe_refresh=true&${ownerParam}`;
      const returnUrl = `${reqOrigin}/onlinePayment.html?stripe_return=true&${ownerParam}`;

      // Account Links are created with the v2 endpoint. The legacy test-mode sandbox
      // only partially supports API v2 (account links with a recipient config are
      // rejected with "Please switch to an account created in a sandbox to test"),
      // so fall back to the v1 endpoint, which accepts v2 Account IDs.
      let linkUrl: string;
      try {
        const linkRes = await stripeFetchV2("/core/account_links", {
          method: "POST",
          body: {
            account: currentAccountId,
            use_case: {
              type: "account_onboarding",
              account_onboarding: {
                refresh_url: refreshUrl,
                return_url: returnUrl
              }
            }
          }
        });
        linkUrl = linkRes.url;
      } catch (err: any) {
        console.warn("v2 account link failed, falling back to v1:", err.message);

        const linkParams = new URLSearchParams();
        linkParams.append("account", currentAccountId);
        linkParams.append("refresh_url", refreshUrl);
        linkParams.append("return_url", returnUrl);
        linkParams.append("type", "account_onboarding");

        try {
          const linkRes = await stripeFetch("/account_links", {
            method: "POST",
            body: linkParams.toString()
          });
          linkUrl = linkRes.url;
        } catch (v1Err: any) {
          throw new Error(
            `No se pudo crear el enlace de onboarding. v2: ${err.message}. v1: ${v1Err.message}`
          );
        }
      }

      return new Response(
        JSON.stringify({ url: linkUrl, account_id: currentAccountId }),
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

      // The v1 retrieve endpoint is fully supported (even for v2 accounts) and returns the
      // canonical charges_enabled / payouts_enabled / details_submitted booleans directly,
      // so it's the primary source of truth. Fall back to v2 (and then to stored values)
      // only if v1 fails.
      let updatedRecord: any = null;
      let requirementsDue: string[] = [];
      let canReceive = false;
      try {
        const v1Account = await stripeFetch(`/accounts/${existingAccount.stripe_account_id}`);
        canReceive =
          v1Account?.capabilities?.transfers === "active" ||
          !!v1Account?.payouts_enabled;
        requirementsDue = [
          ...(v1Account?.requirements?.currently_due || []),
          ...(v1Account?.requirements?.past_due || [])
        ];
        updatedRecord = {
          user_id: effectiveUserId,
          stripe_account_id: v1Account.id || existingAccount.stripe_account_id,
          charges_enabled: !!v1Account.charges_enabled,
          payouts_enabled: canReceive,
          details_submitted: !!v1Account.details_submitted,
          country: (v1Account.country || existingAccount.country || "US").toUpperCase(),
          currency: v1Account.default_currency || existingAccount.currency || "usd",
          updated_at: new Date().toISOString()
        };
      } catch (v1Err: any) {
        console.warn("v1 account retrieve failed, trying v2:", v1Err.message);
        try {
          const stripeAccount = await stripeFetchV2(
            `/core/accounts/${existingAccount.stripe_account_id}` +
              `?include[0]=configuration.merchant` +
              `&include[1]=configuration.recipient` +
              `&include[2]=identity` +
              `&include[3]=requirements`
          );
          if (stripeAccount?.configuration?.merchant || stripeAccount?.configuration?.recipient) {
            const mapped = { user_id: effectiveUserId, ...mapV2AccountToRecord(stripeAccount) };
            canReceive = mapped.payouts_enabled;
            requirementsDue = (stripeAccount?.requirements?.entries || [])
              .filter((e: any) => e?.awaiting_action_from === "user")
              .map((e: any) => e?.description || e?.requirement || "additional_requirements");
            updatedRecord = mapped;
          }
        } catch (v2Err: any) {
          console.warn("v2 account retrieve failed:", v2Err.message);
        }
      }

      if (!updatedRecord) {
        canReceive = !!(existingAccount.payouts_enabled || existingAccount.charges_enabled);
        updatedRecord = {
          user_id: effectiveUserId,
          stripe_account_id: existingAccount.stripe_account_id,
          details_submitted: existingAccount.details_submitted || false,
          charges_enabled: existingAccount.charges_enabled || false,
          payouts_enabled: existingAccount.payouts_enabled || false,
          country: existingAccount.country || "US",
          currency: existingAccount.currency || "usd",
          updated_at: new Date().toISOString()
        };
      }

      await supabaseAdmin.from("menutech_stripe_accounts").upsert(updatedRecord, { onConflict: "user_id" });

      // Auto-set own_stripe only when the account can actually take card payments.
      // (A recipient-only account can receive transfers but not charge, so we no longer
      // key this off charges_enabled alone.)
      if (updatedRecord.charges_enabled) {
        const { data: currentCfg } = await supabaseAdmin
          .from("menutech_restaurant_payment_configs")
          .select("payment_mode")
          .eq("user_id", effectiveUserId)
          .maybeSingle();

        if (!currentCfg || currentCfg.payment_mode === "none") {
          await supabaseAdmin
            .from("menutech_restaurant_payment_configs")
            .upsert({
              user_id: effectiveUserId,
              payment_mode: "own_stripe",
              commission_rate: 0.00,
              updated_at: new Date().toISOString()
            }, { onConflict: "user_id" });
        }
      }

      return new Response(
        JSON.stringify({
          account: updatedRecord,
          can_receive: canReceive,
          requirements_due: requirementsDue
        }),
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
