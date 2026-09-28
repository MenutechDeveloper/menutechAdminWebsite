// Supabase Edge Function: scraping
// Extracts web data using ScrapeGraph AI + Google Gemini for JSON structuring.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ScrapeGraphAI } from "npm:scrapegraph-js";

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
    const payload = await req.json().catch(() => ({}));
    const { url, prompt } = payload;

    if (!url) {
      return new Response(
        JSON.stringify({ error: "Debe proporcionar una URL válida." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userPrompt = prompt || "Extrae todos los datos relevantes de esta página";
    const geminiApiKey = (Deno.env.get("GEMINI_API_KEY") || "").trim();
    const sgaiApiKey = (Deno.env.get("SGAI_API_KEY") || Deno.env.get("SCRAPEGRAPH_API_KEY") || "").trim();

    // 1. Scrape content using ScrapeGraph AI
    let scrapedData: any = null;
    let sgError: string | null = null;

    try {
      let sgai: any;
      if (sgaiApiKey) {
        try {
          sgai = typeof ScrapeGraphAI === "function" ? (ScrapeGraphAI as any)({ apiKey: sgaiApiKey }) : new (ScrapeGraphAI as any)({ apiKey: sgaiApiKey });
        } catch (_) {
          sgai = (ScrapeGraphAI as any)({ apiKey: sgaiApiKey });
        }
      } else {
        try {
          sgai = typeof ScrapeGraphAI === "function" ? (ScrapeGraphAI as any)() : new (ScrapeGraphAI as any)();
        } catch (_) {
          sgai = (ScrapeGraphAI as any)();
        }
      }

      const result = await sgai.extract({
        url: url,
        prompt: userPrompt,
      });

      if (result && result.status === "success") {
        scrapedData = result.data;
      } else if (result && result.data) {
        scrapedData = result.data;
      } else if (result && result.error) {
        sgError = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
      } else {
        scrapedData = result;
      }
    } catch (err: any) {
      console.warn("ScrapeGraphAI direct call failed:", err?.message || err);
      sgError = err?.message || String(err);
    }

    // Fallback REST call to ScrapeGraph AI if SDK didn't return data and API Key exists
    if (!scrapedData && sgaiApiKey) {
      try {
        const sgRes = await fetch("https://api.scrapegraphai.com/v1/smartscraper", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "sgai-api-key": sgaiApiKey,
          },
          body: JSON.stringify({
            website_url: url,
            user_prompt: userPrompt,
          }),
        });

        if (sgRes.ok) {
          const sgJson = await sgRes.json();
          scrapedData = sgJson.result || sgJson.data || sgJson;
        }
      } catch (fErr: any) {
        console.warn("ScrapeGraph REST fallback failed:", fErr);
      }
    }

    // Fallback HTML fetch if ScrapeGraph data is unavailable or empty
    if (!scrapedData) {
      try {
        const pageRes = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        });
        if (pageRes.ok) {
          const rawHtml = await pageRes.text();
          // Trim HTML to avoid exceeding token limits
          scrapedData = { rawHtml: rawHtml.substring(0, 50000) };
        }
      } catch (hErr: any) {
        console.warn("HTML fetch fallback failed:", hErr);
      }
    }

    if (!scrapedData) {
      return new Response(
        JSON.stringify({
          error: `No se pudieron obtener datos de la URL (${url}). ${sgError ? "Detalle: " + sgError : ""}`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Format with Google Gemini
    if (!geminiApiKey) {
      // If Gemini key is missing, return raw scraped data
      return new Response(
        JSON.stringify({
          data: scrapedData,
          type: "generic",
          warning: "GEMINI_API_KEY no encontrada. Se devolvieron los datos procesados únicamente por ScrapeGraph AI.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiSystemPrompt = `Eres un asistente de extracción de datos extremadamente preciso.
Tu trabajo es organizar los datos scrapeados de la URL (${url}) respondiendo a la instrucción del usuario: "${userPrompt}".

DEBES DEVOLVER ÚNICAMENTE UN OBJETO JSON VÁLIDO. No agregues comillas de Markdown (\`\`\`json), ni introducciones, ni explicaciones fuera del JSON.

INSTRUCCIONES DE ESTRUCTURA:
1. Si los datos corresponden a un menú de restaurante, el JSON debe usar la siguiente estructura:
{
  "type": "menu",
  "restaurant": {
    "name": "Nombre del restaurante",
    "address": "Dirección",
    "phone": "Teléfono",
    "hours": "Horarios de atención",
    "websiteUrl": "${url}"
  },
  "categories": [
    {
      "name": "Nombre de la Categoría",
      "dishes": [
        {
          "name": "Nombre del platillo",
          "price": "$0.00",
          "description": "Descripción del platillo",
          "image": "URL de la imagen o vacía",
          "availability": "Disponible",
          "variants": ["Tamaño chico", "Tamaño grande"],
          "extras": ["Extra queso", "Salsa especial"]
        }
      ]
    }
  ]
}

2. Si los datos corresponden a negocios o resultados de Google Maps / zona, el JSON debe usar la siguiente estructura:
{
  "type": "business_list",
  "businesses": [
    {
      "name": "Nombre del negocio",
      "category": "Categoría o giro",
      "address": "Dirección completa",
      "phone": "Teléfono de contacto",
      "websiteUrl": "Sitio web",
      "googleMapsUrl": "URL de Google Maps",
      "rating": "4.5",
      "reviewsCount": "120",
      "hours": "Horario",
      "zone": "Zona o colonia"
    }
  ]
}

3. Si es otro tipo de información solicitada por el usuario, utiliza "type": "generic" con un campo "data" que contenga la información organizada limpiamente en arreglos u objetos.

Únicamente incluye información que esté respaldada por los datos scrapeados provistos a continuación:
${JSON.stringify(scrapedData).substring(0, 80000)}`;

    const geminiPayload = {
      contents: [{ parts: [{ text: geminiSystemPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    };

    let geminiResponseText = "";
    // Try primary gemini model endpoints
    const modelsToTry = [
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];

    for (const modelName of modelsToTry) {
      try {
        const gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(geminiPayload),
          }
        );

        if (gRes.ok) {
          const gJson = await gRes.json();
          const candText = gJson.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candText) {
            geminiResponseText = candText;
            break;
          }
        }
      } catch (mErr) {
        console.warn(`Gemini model ${modelName} failed:`, mErr);
      }
    }

    if (!geminiResponseText) {
      return new Response(
        JSON.stringify({
          data: scrapedData,
          type: "generic",
          warning: "No se pudo obtener respuesta de Gemini API. Mostrando datos de ScrapeGraph.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean Markdown wrapper if present
    let cleanJsonStr = geminiResponseText.trim();
    if (cleanJsonStr.startsWith("```json")) {
      cleanJsonStr = cleanJsonStr.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (cleanJsonStr.startsWith("```")) {
      cleanJsonStr = cleanJsonStr.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    let finalStructuredData: any;
    try {
      finalStructuredData = JSON.parse(cleanJsonStr);
    } catch (parseErr) {
      console.warn("Failed to parse Gemini output as JSON, returning raw string inside object", parseErr);
      finalStructuredData = {
        type: "generic",
        data: scrapedData,
        rawGeminiReply: geminiResponseText,
      };
    }

    return new Response(
      JSON.stringify(finalStructuredData),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Error interno en Edge Function: " + err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
