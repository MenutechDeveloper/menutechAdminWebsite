// ====================================================================
// SUPABASE EDGE FUNCTION PARA TRANSCRIPCIÓN DE MENÚS (LectorMenus/index.ts)
// ====================================================================
// Transcribe imágenes de menús usando Google Gemini AI Vision y
// retorna un objeto JSON estructurado con secciones, platillos, precios y descripciones.
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface RequestBody {
  prompt?: string;
  message?: string;
  image?: string | { mimeType?: string; data?: string };
  image_url?: string;
  image_base64?: string;
  image_mime?: string;
}

// Descubrimiento dinámico de modelos de Gemini
async function discoverAvailableGeminiModels(apiKey: string): Promise<string[]> {
  const versions = ['v1beta', 'v1'];
  const foundModels: string[] = [];

  for (const ver of versions) {
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models?key=${apiKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.models)) {
          for (const m of data.models) {
            if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent') && !m.name.includes("2.5") && !m.name.includes("deprecated")) {
              const nameOnly = m.name.replace(/^models\//, '');
              if (!foundModels.includes(nameOnly)) {
                foundModels.push(nameOnly);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn(`Error descubriendo modelos en versión ${ver}:`, e);
    }
  }

  if (foundModels.length === 0) {
    return ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  }

  foundModels.sort((a, b) => {
    const aRank = a.includes("2.0-flash") ? 0 : a.includes("1.5-flash") ? 1 : 2;
    const bRank = b.includes("2.0-flash") ? 0 : b.includes("1.5-flash") ? 1 : 2;
    return aRank - bRank;
  });

  return foundModels;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json().catch(() => ({}));
    const {
      prompt,
      message,
      image,
      image_url,
      image_base64,
      image_mime = 'image/jpeg'
    } = body;

    const apiKey = (
      Deno.env.get('GEMINI_API_KEY') ||
      Deno.env.get('Spirit') ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''
    ).trim();

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'No se encontró la API Key de Gemini en el servidor (GEMINI_API_KEY).' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let rawImageData: string | undefined;
    let mimeType = image_mime || 'image/jpeg';

    if (typeof image === 'string') {
      rawImageData = image;
    } else if (image && typeof image === 'object') {
      if (image.mimeType) mimeType = image.mimeType;
      if (image.data) rawImageData = image.data;
    }

    if (!rawImageData) {
      rawImageData = image_base64 || image_url;
    }

    if (!rawImageData) {
      return new Response(
        JSON.stringify({ error: 'No se proporcionó ninguna imagen para transcribir.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let cleanBase64 = rawImageData;
    if (rawImageData.includes('base64,')) {
      const header = rawImageData.substring(0, rawImageData.indexOf('base64,'));
      if (header.includes(':') && header.includes(';')) {
        mimeType = header.substring(header.indexOf(':') + 1, header.indexOf(';')) || mimeType;
      }
      cleanBase64 = rawImageData.split('base64,')[1];
    }

    const candidateModels = await discoverAvailableGeminiModels(apiKey);

    const userInstruction = (prompt || message || 'Transcribe todo el menú de esta imagen de forma limpia, organizada y estructurada.').trim();

    const systemInstruction = {
      parts: [
        {
          text: `Eres un asistente experto en transcripción OCR y análisis visual de menús de restaurantes y negocios de comida.
Tu tarea es examinar con máxima atención la imagen del menú proporcionada y extraer TODO el texto transcribiéndolo exactamente como aparece pero organizándolo de forma pulcra por secciones y categorías.

REGLAS OBLIGATORIAS:
1. Responde ÚNICAMENTE un objeto JSON válido (sin markdown extra, sin triple comillas si es posible, o en un bloque \`\`\`json).
2. La estructura del JSON debe ser exactamente la siguiente:
{
  "type": "menu",
  "restaurant": {
    "name": "Nombre del restaurante si figura en la imagen, o vacío",
    "address": "Dirección si figura, o vacío",
    "phone": "Teléfono si figura, o vacío",
    "hours": "Horario si figura, o vacío"
  },
  "categories": [
    {
      "name": "Nombre de la Sección o Categoría (ej. Tacos, Bebidas, Postres, etc.)",
      "dishes": [
        {
          "name": "Nombre del platillo o ítem",
          "price": "Precio exacto transcrito (ej. $50, 50 pesos, etc.)",
          "description": "Descripción del platillo o ingredientes si figuran, o vacío",
          "variants": ["Variantes si existen"],
          "extras": ["Extras o adicionales si existen"]
        }
      ]
    }
  ]
}
3. Asegúrate de transcribir todos los platillos, precios y descripciones legibles sin omitir ningún detalle de la imagen.`
        }
      ]
    };

    const contents = [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: cleanBase64
            }
          },
          {
            text: userInstruction
          }
        ]
      }
    ];

    let aiData: any = null;
    let lastApiError: string = '';

    for (const modelName of candidateModels) {
      const apiVersion = 'v1beta';
      const geminiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;

      try {
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction,
            contents,
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4096
            }
          })
        });

        const data = await res.json();
        if (res.ok && data.candidates && data.candidates.length > 0) {
          aiData = data;
          break;
        } else if (data.error && data.error.message) {
          lastApiError = `[${modelName}] ${data.error.message}`;
        }
      } catch (e: any) {
        lastApiError = `[${modelName}] ${e.message}`;
      }
    }

    if (!aiData) {
      return new Response(
        JSON.stringify({ error: `Ocurrió un error al procesar con Gemini AI: ${lastApiError || 'Sin respuesta.'}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const candidate = aiData.candidates?.[0];
    const resParts = candidate?.content?.parts || [];
    let rawText = '';
    for (const part of resParts) {
      if (part.text) rawText += part.text;
    }

    // Clean JSON code blocks if present
    let jsonString = rawText.trim();
    if (jsonString.includes('```')) {
      jsonString = jsonString.replace(/```json/gi, '').replace(/```/g, '').trim();
    }

    let parsedMenu: any = null;
    try {
      parsedMenu = JSON.parse(jsonString);
    } catch (_e) {
      // Fallback object if raw text isn't perfect JSON
      parsedMenu = {
        type: "menu",
        restaurant: { name: "", address: "", phone: "", hours: "" },
        categories: [
          {
            name: "Transcripción General",
            dishes: [
              {
                name: "Texto extraído",
                price: "",
                description: rawText
              }
            ]
          }
        ]
      };
    }

    return new Response(
      JSON.stringify({
        success: true,
        reply: "Menú transcrito con éxito.",
        menu: parsedMenu,
        ...parsedMenu
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: 'Error interno en LectorMenus: ' + error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
