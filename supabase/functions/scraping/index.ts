// Supabase Edge Function: scraping
// Extracts web data using ScrapeGraph AI + Google Gemini for JSON structuring.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ScrapeGraphAI } from "npm:scrapegraph-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Clean minified JS, CSS styles, and markup noise
function sanitizeHtmlAndRawData(content: any): string {
  if (!content) return "";
  let str = typeof content === "string" ? content : JSON.stringify(content);

  // Strip script, style, and svg tags completely along with their contents
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  str = str.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  str = str.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ");

  // Remove inline JS code signatures
  str = str.replace(/function\s*\([^)]*\)\s*\{[^}]*\}/g, " ");
  str = str.replace(/var\s+[a-zA-Z0-9_$]+\s*=\s*function\b/g, " ");

  // Collapse multiple whitespaces
  str = str.replace(/\s+/g, " ").trim();
  return str;
}

// Extract ruid / restaurant_uid from URL
function extractRuidFromUrl(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    const ruid = parsed.searchParams.get("restaurant_uid") || parsed.searchParams.get("ruid");
    if (ruid) return ruid;
  } catch (_) {}
  const match = urlStr.match(/(?:restaurant_uid|ruid)=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  return match ? match[1] : null;
}

// Transform Foodbooking / Menutech API JSON directly into clean structured menu object
function transformFoodbookingToMenu(apiJson: any, sourceUrl: string) {
  const root = apiJson?.data || apiJson || {};
  const terms = root.terms || {};
  const menuObj = root.menu || {};
  const categoriesList = menuObj.categories || root.categories || [];
  const picturesObj = root.pictures || {};
  const cdnBase = root.cdn_base_path || "https://www.fbgcdn.com/pictures/";

  const restaurantName = root.name || terms.company_name || "Restaurante Digital";
  const restaurantAddress = root.address || [terms.address, terms.city, terms.zip, terms.country_code].filter(Boolean).join(", ");
  const restaurantPhone = root.phone || terms.phone || root.phones || "";

  let formattedHours = "";
  if (Array.isArray(root.opening_hours) && root.opening_hours.length > 0) {
    const hoursList = root.opening_hours.map((oh: any) => {
      const startH = String(Math.floor(oh.begin_minute / 60)).padStart(2, "0");
      const startM = String(oh.begin_minute % 60).padStart(2, "0");
      const endH = String(Math.floor(oh.end_minute / 60)).padStart(2, "0");
      const endM = String(oh.end_minute % 60).padStart(2, "0");
      return `${startH}:${startM} - ${endH}:${endM}`;
    });
    formattedHours = Array.from(new Set(hoursList)).join(" | ");
  }

  const categories: any[] = [];

  categoriesList.forEach((cat: any) => {
    const catName = cat.name || "Menú General";
    const items = cat.items || [];
    const dishes: any[] = [];

    items.forEach((it: any) => {
      if (it && it.name) {
        let imgUrl = "";
        if (picturesObj) {
          const pKey = `menu_item-${it.id}`;
          const pKeySmall = `menu_item_small-${it.id}`;
          const picItem = picturesObj[pKey] || picturesObj[pKeySmall];
          if (picItem && picItem.filename) {
            imgUrl = `${cdnBase}${picItem.filename}`;
          }
        }

        let priceText = "";
        if (it.price !== undefined && it.price !== null) {
          priceText = `$${parseFloat(it.price).toFixed(2)}`;
        }

        const variants: string[] = [];
        if (Array.isArray(it.sizes) && it.sizes.length > 0) {
          it.sizes.forEach((s: any) => {
            if (s && s.name) {
              const sPrice = s.price ? ` ($${parseFloat(s.price).toFixed(2)})` : "";
              variants.push(`${s.name}${sPrice}`);
            }
          });
        }

        const extras: string[] = [];
        if (Array.isArray(it.groups) && it.groups.length > 0) {
          it.groups.forEach((g: any) => {
            if (g && g.name) {
              const opts = (g.options || []).map((o: any) => o.name).filter(Boolean).slice(0, 4);
              if (opts.length > 0) {
                extras.push(`${g.name}: ${opts.join(", ")}`);
              } else {
                extras.push(g.name);
              }
            }
          });
        }

        dishes.push({
          name: it.name,
          price: priceText,
          description: it.description || "",
          image: imgUrl,
          availability: it.is_out_of_stock ? "Agotado" : "Disponible",
          variants: variants,
          extras: extras,
        });
      }
    });

    if (dishes.length > 0) {
      categories.push({
        name: catName,
        dishes: dishes,
      });
    }
  });

  return {
    type: "menu",
    restaurant: {
      name: restaurantName,
      address: restaurantAddress,
      phone: restaurantPhone,
      hours: formattedHours,
      websiteUrl: sourceUrl,
    },
    categories: categories,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    let { url, prompt, mode: reqMode } = payload;

    if (!url || typeof url !== "string" || !url.trim()) {
      return new Response(
        JSON.stringify({ error: "Debe proporcionar una URL o término de búsqueda válido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    url = url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    let mode = reqMode || "extract";
    if (url.includes("google.com/search") || url.includes("google.com/maps") || mode === "search") {
      mode = "search";
    }

    const defaultPrompt = mode === "search"
      ? "Analiza los datos obtenidos de la búsqueda y extrae la información disponible de cada restaurante o negocio encontrado, incluyendo nombre, categoría, dirección, teléfono, sitio web, URL de Google Maps, calificación, número de reseñas, horarios y zona."
      : "Extrae todos los platillos, categorías, precios, descripciones, imágenes y datos del restaurante disponibles.";

    const userPrompt = prompt && prompt.trim() !== "" ? prompt.trim() : defaultPrompt;
    const geminiApiKey = (Deno.env.get("GEMINI_API_KEY") || "").trim();
    const sgaiApiKey = (Deno.env.get("SGAI_API_KEY") || Deno.env.get("SCRAPEGRAPH_API_KEY") || "").trim();

    let scrapedData: any = null;
    let sgError: string | null = null;

    // 1. Check if URL contains Menutech / Foodbooking digital menu RUID directly
    const digitalRuid = extractRuidFromUrl(url);
    if (digitalRuid) {
      console.log(`Detected digital ordering RUID: ${digitalRuid}`);
      const apiEndpoints = [
        `https://www.menu-technology.com/api/restaurant/${digitalRuid}`,
        `https://www.foodbooking.com/api/restaurant/${digitalRuid}`,
        `https://api.foodbooking.com/api/restaurant/${digitalRuid}`,
      ];

      for (const endpoint of apiEndpoints) {
        try {
          const apiRes = await fetch(endpoint, { headers: { "Accept": "application/json" } });
          if (apiRes.ok) {
            const menuJson = await apiRes.json();
            if (menuJson) {
              const formattedMenu = transformFoodbookingToMenu(menuJson, url);
              if (formattedMenu.categories && formattedMenu.categories.length > 0) {
                console.log(`Successfully formatted ${formattedMenu.categories.length} categories with dishes directly via API.`);
                return new Response(
                  JSON.stringify(formattedMenu),
                  { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
              }
            }
          }
        } catch (apiErr) {
          console.warn("Digital menu API fetch failed:", apiErr);
        }
      }
    }

    // 2. Scrape content using ScrapeGraph AI if no digital API data obtained
    if (!scrapedData && sgaiApiKey) {
      try {
        let sgai: any;
        try {
          sgai = typeof ScrapeGraphAI === "function" ? (ScrapeGraphAI as any)({ apiKey: sgaiApiKey }) : new (ScrapeGraphAI as any)({ apiKey: sgaiApiKey });
        } catch (_) {
          sgai = (ScrapeGraphAI as any)({ apiKey: sgaiApiKey });
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

      // Invalidate scrapedData if ScrapeGraph SDK returned an error response
      if (scrapedData && (scrapedData.status === "error" || scrapedData.error)) {
        console.warn("ScrapeGraph SDK returned error status:", scrapedData);
        sgError = scrapedData.error || scrapedData.status;
        scrapedData = null;
      }

      // Fallback REST call to ScrapeGraph AI endpoints with all key header variations
      if (!scrapedData) {
        try {
          let endpoint = "https://api.scrapegraphai.com/v1/smartscraper";
          let bodyPayload: any = { website_url: url, user_prompt: userPrompt };

          if (mode === "search") {
            endpoint = "https://api.scrapegraphai.com/v1/smartsearch";
            bodyPayload = { user_prompt: `${userPrompt}. Target query or URL: ${url}` };
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
              "SGAI-APIKEY": sgaiApiKey,
              "sgai-api-key": sgaiApiKey,
              "x-api-key": sgaiApiKey,
              "Authorization": `Bearer ${sgaiApiKey}`,
            },
            body: JSON.stringify(bodyPayload),
          });

          if (sgRes.ok) {
            const sgJson = await sgRes.json();
            if (sgJson && sgJson.status !== "error" && !sgJson.error) {
              scrapedData = sgJson.result || sgJson.data || sgJson;
            } else {
              console.warn("ScrapeGraph REST returned error object:", sgJson);
              sgError = JSON.stringify(sgJson);
            }
          } else {
            const errText = await sgRes.text().catch(() => "");
            console.warn(`ScrapeGraph REST status ${sgRes.status}:`, errText);
            sgError = `HTTP ${sgRes.status} ${errText}`;
          }
        } catch (fErr: any) {
          console.warn("ScrapeGraph REST fallback failed:", fErr);
        }
      }
    }

    // 3. Direct HTML fetch fallback if ScrapeGraph data is unavailable or errored
    if (!scrapedData && url.startsWith("http")) {
      try {
        console.log("Attempting direct HTML fetch fallback for:", url);
        const pageRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          },
        });
        if (pageRes.ok) {
          const rawHtml = await pageRes.text();
          if (rawHtml && rawHtml.length > 100) {
            scrapedData = { rawHtml: rawHtml };
          }
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

    // 4. Format with Google Gemini API
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          data: scrapedData,
          type: "generic",
          warning: "GEMINI_API_KEY no encontrada. Se devolvieron los datos extraídos.",
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
          "price": "Precio real (ej. $12.50)",
          "description": "Descripción real del platillo",
          "image": "URL de la imagen del platillo si está disponible",
          "availability": "Disponibilidad real",
          "variants": ["Tamaños o variantes reales"],
          "extras": ["Opciones o extras reales"]
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

DATOS BRUTOS REALES A ANALIZAR:
${cleanedTextData.substring(0, 95000)}`;

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
        } else {
          const errText = await gRes.text();
          console.warn(`Gemini model ${modelName} returned status ${gRes.status}:`, errText);
        }
      } catch (mErr) {
        console.warn(`Gemini model ${modelName} fetch failed:`, mErr);
      }
    }

    if (!geminiResponseText) {
      return new Response(
        JSON.stringify({
          data: scrapedData,
          type: "generic",
          warning: "No se pudo obtener respuesta estructurada de Gemini API. Devolviendo datos extraídos.",
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
      console.warn("Failed to parse Gemini output as JSON:", parseErr);
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
