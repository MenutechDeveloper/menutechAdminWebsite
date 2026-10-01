// Supabase Edge Function: apify-scraper
// Executes Apify Actor nwua9Gu5YrADL7ZDj (Google Maps Scraper) and returns results to extractor.html
// NOTE: The Apify API Key MUST be stored in Supabase Secrets under the name: APIFY_API_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACTOR_ID = "nwua9Gu5YrADL7ZDj";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    let { search, location, limit, url, input, timeout } = payload;

    // Retrieve Apify API key securely from Supabase Secrets (named APIFY_API_KEY)
    const apifyApiKey = (
      Deno.env.get("APIFY_API_KEY") ||
      Deno.env.get("APIFY_KEY") ||
      Deno.env.get("APIFY_TOKEN") ||
      ""
    ).trim();

    if (!apifyApiKey) {
      return new Response(
        JSON.stringify({ error: "APIFY_API_KEY no encontrada en los secrets de Supabase. Asegúrate de haberla guardado como APIFY_API_KEY." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Construct actor input object strictly matching compass/google-maps-scraper input schema
    let actorInput: any = {};

    if (input && typeof input === "object") {
      actorInput = input;
    } else {
      const maxResults = parseInt(limit || "20", 10) || 20;

      if (search || location) {
        const categoryStr = (search || "restaurant").trim();
        const locationStr = (location || "").trim();
        const fullSearchTerm = locationStr ? `${categoryStr} in ${locationStr}` : categoryStr;

        actorInput = {
          searchStringsArray: [fullSearchTerm],
          locationQuery: locationStr,
          maxCrawledPlacesPerSearch: maxResults,
          language: "es"
        };
      } else if (url) {
        let cleanUrl = String(url).trim();
        if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
          cleanUrl = "https://" + cleanUrl;
        }
        actorInput = {
          startUrls: [{ url: cleanUrl }],
          maxCrawledPlacesPerSearch: maxResults,
          language: "es"
        };
      } else {
        actorInput = payload;
      }
    }

    console.log(`Executing Apify Actor ${ACTOR_ID} with input:`, JSON.stringify(actorInput));

    // Try synchronous run first (timeout up to 120 seconds)
    const runTimeout = timeout || 120;
    const syncUrl = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${apifyApiKey}&timeout=${runTimeout}`;

    const syncRes = await fetch(syncUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actorInput),
    });

    if (syncRes.ok) {
      const items = await syncRes.json();
      return new Response(
        JSON.stringify({ success: true, actorId: ACTOR_ID, data: items }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If sync run returned non-200 (or HTTP 201/408 timeout), attempt run + poll fallback
    const syncErrText = await syncRes.text().catch(() => "");
    console.warn(`Sync run status ${syncRes.status}: ${syncErrText}. Retrying via async run & poll...`);

    const startRunUrl = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${apifyApiKey}`;
    const startRunRes = await fetch(startRunUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actorInput),
    });

    if (!startRunRes.ok) {
      const errText = await startRunRes.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `Error al iniciar Actor en Apify (HTTP ${startRunRes.status}): ${errText}` }),
        { status: startRunRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const runData = await startRunRes.json();
    const runId = runData?.data?.id;
    const datasetId = runData?.data?.defaultDatasetId;

    if (!runId || !datasetId) {
      return new Response(
        JSON.stringify({ error: "Respuesta de Apify no contiene runId o defaultDatasetId.", raw: runData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Poll run status for up to 60 seconds
    let status = runData?.data?.status;
    let attempts = 0;
    const maxAttempts = 30; // 30 * 2s = 60s

    while (["READY", "RUNNING"].includes(status) && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;

      const checkUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyApiKey}`;
      const checkRes = await fetch(checkUrl);
      if (checkRes.ok) {
        const checkJson = await checkRes.json();
        status = checkJson?.data?.status;
      }
    }

    if (status !== "SUCCEEDED") {
      return new Response(
        JSON.stringify({
          error: `El Actor finalizó con estado: ${status}.`,
          runId: runId,
          status: status
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch dataset items
    const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyApiKey}`;
    const datasetRes = await fetch(datasetUrl);
    if (!datasetRes.ok) {
      const errText = await datasetRes.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `Error al obtener dataset de Apify: ${errText}` }),
        { status: datasetRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const datasetItems = await datasetRes.json();
    return new Response(
      JSON.stringify({ success: true, actorId: ACTOR_ID, runId: runId, data: datasetItems }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Error interno en Edge Function: " + err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
