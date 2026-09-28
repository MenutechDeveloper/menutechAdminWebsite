// Supabase Edge Function: scraping
// Extracts web data using ScrapeGraph AI + Google Gemini for JSON structuring.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ScrapeGraphAI } from "npm:scrapegraph-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper function to clean minified JS, CSS styles, and useless markup noise
function sanitizeHtmlAndRawData(content: any): string {
  if (!content) return "";
  let str = typeof content === "string" ? content : JSON.stringify(content);

  // Strip script and style tags completely along with their contents
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  str = str.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  str = str.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ");

  // Remove inline JS code signatures (e.g., function(...), closure_uid, etc.)
  str = str.replace(/function\s*\([^)]*\)\s*\{[^}]*\}/g, " ");
  str = str.replace(/var\s+[a-zA-Z0-9_$]+\s*=\s*function\b/g, " ");

  // Collapse multiple whitespaces
  str = str.replace(/\s+/g, " ").trim();
  return str;
}

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
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
        });
        if (pageRes.ok) {
          const rawHtml = await pageRes.text();
          scrapedData = { rawHtml: rawHtml };
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

    // Clean and sanitize scraped payload before feeding Gemini
    const cleanedTextData = sanitizeHtmlAndRawData(scrapedData);

    // 2. Format with Google Gemini
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          data: scrapedData,
          type: "generic",
          warning: "GEMINI_API_KEY no encontrada. Se devolvieron los datos procesados únicamente por ScrapeGraph AI.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiSystemPrompt = `REGLA DE ORO OBLIGATORIA: DEBES DEVOLVER ÚNICAMENTE UN OBJETO JSON VÁLIDO.
NO incluyas bloques de código JavaScript, minificados, ni scripts de la página. Ignera totalmente código fuente o scripts JS. Extrae EXCLUSIVAMENTE información humana/de negocio de la página (${url}) respondiendo a: "${userPrompt}".

ESTRUCTURAS PERMITIDAS SEGÚN EL TIPO DE DATOS:

1. Si el usuario solicita un menú de restaurante o los datos son de un menú:
{
  "type": "menu",
  "restaurant": {
    "name": "Nombre del restaurante",
    "address": "Dirección completa",
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
          "image": "URL de la imagen (o vacía)",
          "availability": "Disponible",
          "variants": ["Chico", "Grande"],
          "extras": ["Queso extra"]
        }
      ]
    }
  ]
}

2. Si el usuario solicita negocios, restaurantes por zona, o resultados de Google Maps/búsquedas:
{
  "type": "business_list",
  "businesses": [
    {
      "name": "Nombre del negocio",
      "category": "Giro o tipo de cocina",
      "address": "Dirección",
      "phone": "Teléfono",
      "websiteUrl": "Enlace al sitio web del negocio",
      "googleMapsUrl": "Enlace a Google Maps",
      "rating": "4.5",
      "reviewsCount": "150",
      "hours": "Horario",
      "zone": "Zona o colonia"
    }
  ]
}

3. Si es otro tipo de consulta genérica, utiliza:
{
  "type": "generic",
  "title": "Resumen de Extracción",
  "data": [
    {
      "title": "Elemento 1",
      "description": "Detalles del elemento",
      "url": "Enlace si aplica"
    }
  ]
}

DATOS SCRAPEADOS A ANALIZAR (SANTIZADOS SIN SCRIPTS/MINIFICADOS):
${cleanedTextData.substring(0, 90000)}`;

    const geminiPayload = {
      contents: [{ parts: [{ text: geminiSystemPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    };

    let geminiResponseText = "";
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
          warning: "No se pudo obtener respuesta estructurada de Gemini API. Mostrando datos de ScrapeGraph.",
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
      console.warn("Failed to parse Gemini output as JSON, returning formatted generic fallback", parseErr);
      finalStructuredData = {
        type: "generic",
        title: "Resultado de Extracción",
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
