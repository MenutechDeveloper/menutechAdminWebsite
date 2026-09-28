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
    const { url, prompt, mode: reqMode } = payload;

    if (!url) {
      return new Response(
        JSON.stringify({ error: "Debe proporcionar una URL o término de búsqueda válido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auto-detect mode if Google search/maps URL or query
    let mode = reqMode || "extract";
    if (url.includes("google.com/search") || url.includes("google.com/maps") || mode === "search") {
      mode = "search";
    }

    const defaultPrompt = mode === "search"
      ? "Analiza los datos obtenidos de la búsqueda y extrae la información disponible de cada restaurante o negocio encontrado, incluyendo nombre, categoría, dirección, teléfono, sitio web, URL de Google Maps, calificación, número de reseñas, horarios y zona."
      : "Extrae todos los datos e información relevante disponible de esta página de forma precisa.";

    const userPrompt = prompt && prompt.trim() !== "" ? prompt.trim() : defaultPrompt;
    const geminiApiKey = (Deno.env.get("GEMINI_API_KEY") || "").trim();
    const sgaiApiKey = (Deno.env.get("SGAI_API_KEY") || Deno.env.get("SCRAPEGRAPH_API_KEY") || "").trim();

    // 1. Scrape content using ScrapeGraph AI according to requested mode
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

      if (mode === "search" && typeof sgai.search === "function") {
        const res = await sgai.search({ prompt: userPrompt, url: url });
        scrapedData = res?.data || res?.result || res;
      } else if (mode === "scrape" && typeof sgai.markdownify === "function") {
        const res = await sgai.markdownify({ url: url });
        scrapedData = res?.data || res?.result || res;
      } else if (mode === "crawl" && typeof sgai.crawl === "function") {
        const res = await sgai.crawl({ url: url, prompt: userPrompt });
        scrapedData = res?.data || res?.result || res;
      } else if (typeof sgai.extract === "function") {
        const res = await sgai.extract({ url: url, prompt: userPrompt });
        scrapedData = res?.data || res?.result || res;
      }
    } catch (err: any) {
      console.warn("ScrapeGraphAI SDK call failed:", err?.message || err);
      sgError = err?.message || String(err);
    }

    // Fallback REST call to ScrapeGraph AI if SDK didn't return data and API Key exists
    if (!scrapedData && sgaiApiKey) {
      try {
        let endpoint = "https://api.scrapegraphai.com/v1/smartscraper";
        let bodyPayload: any = { website_url: url, user_prompt: userPrompt };

        if (mode === "search") {
          endpoint = "https://api.scrapegraphai.com/v1/smartsearch";
          bodyPayload = { user_prompt: `${userPrompt}. Target query/URL: ${url}` };
        } else if (mode === "scrape") {
          endpoint = "https://api.scrapegraphai.com/v1/markdownify";
          bodyPayload = { website_url: url };
        } else if (mode === "crawl") {
          endpoint = "https://api.scrapegraphai.com/v1/crawler";
          bodyPayload = { website_url: url, user_prompt: userPrompt };
        }

        const sgRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "sgai-api-key": sgaiApiKey,
          },
          body: JSON.stringify(bodyPayload),
        });

        if (sgRes.ok) {
          const sgJson = await sgRes.json();
          scrapedData = sgJson.result || sgJson.data || sgJson;
        }
      } catch (fErr: any) {
        console.warn("ScrapeGraph REST fallback failed:", fErr);
      }
    }

    // Fallback direct HTML fetch if ScrapeGraph data is unavailable
    if (!scrapedData && url.startsWith("http")) {
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
          error: `No se pudieron obtener datos de la URL o búsqueda (${url}). ${sgError ? "Detalle: " + sgError : ""}`,
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

    const geminiSystemPrompt = `REGLA DE ORO STRICTA Y OBLIGATORIA:
1. DEBES DEVOLVER ÚNICAMENTE UN OBJETO JSON VÁLIDO.
2. NUNCA INVENTES DATOS, NUNCA GENERES EJEMPLOS, PLACEHOLDERS O FALSAS TARJETAS COMO "Elemento 1", "Elemento 2" O VALORES FICTICIOS.
3. Extrae EXCLUSIVAMENTE la información REAL Y HUMANA presente en los datos scrapeados de (${url}) atendiendo a la instrucción: "${userPrompt}".
4. Si un campo no está disponible en los datos scrapeados, déjalo como cadena vacía "" o no lo incluyas. NUNCA insertes texto de relleno.

ESTRUCTURAS PERMITIDAS SEGÚN EL TIPO DE DATOS ENCONTRADOS:

1. Menú de restaurante (si se detectan platillos, precios, categorías o menú):
{
  "type": "menu",
  "restaurant": {
    "name": "Nombre real o vacío",
    "address": "Dirección real o vacía",
    "phone": "Teléfono real o vacío",
    "hours": "Horario real o vacío",
    "websiteUrl": "${url}"
  },
  "categories": [
    {
      "name": "Nombre real de la categoría",
      "dishes": [
        {
          "name": "Nombre real del platillo",
          "price": "Precio real",
          "description": "Descripción real",
          "image": "URL real de la imagen",
          "availability": "Disponibilidad real",
          "variants": ["Variante 1"],
          "extras": ["Extra 1"]
        }
      ]
    }
  ]
}

2. Lista de Negocios / Búsquedas de Google Maps / Google Search / Directorios:
{
  "type": "business_list",
  "businesses": [
    {
      "name": "Nombre real del negocio",
      "category": "Giro / Categoría real",
      "address": "Dirección real",
      "phone": "Teléfono real",
      "websiteUrl": "Sitio web real",
      "googleMapsUrl": "URL real de Google Maps",
      "rating": "Calificación real (ej. 4.5)",
      "reviewsCount": "Número real de reseñas",
      "hours": "Horario real",
      "zone": "Zona o ubicación real"
    }
  ]
}

3. Datos genéricos o estructurados de otro tipo:
{
  "type": "generic",
  "title": "Datos Extraídos",
  "data": [
    {
      "name": "Nombre real encontrado",
      "description": "Descripción o detalle real",
      "price": "Precio si aplica",
      "category": "Categoría si aplica",
      "url": "Enlace si aplica"
    }
  ]
}

DATOS SCRAPEADOS REALES A ANALIZAR:
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
