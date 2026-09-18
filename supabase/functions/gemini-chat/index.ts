// Supabase Edge Function: gemini-chat
// Dynamic Gemini API Model Discovery & Multimodal Execution for Menutech AI

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_INSTRUCTION = `Eres la Inteligencia Artificial de Menutech (Menutech Bot) encargada de responder dudas sobre la plataforma, servicios y pedidos de restaurantes.

REGLAS OBLIGATORIAS DE RESPUESTA:
1. RESPONDE SIEMPRE EN ESPAÑOL DE FORMA DIRECTA, PROFESIONAL Y CORTA.
2. PUEDES AYUDAR CON PREGUNTAS SOBRE:
   - Menús digitales interactivos, Códigos QR y plataforma de menús.
   - Diseñador 3D de camisetas y productos en Menutech.
   - Impresión de tickets e impresoras térmicas.
   - Configuración de restaurantes, galerías y sitios web.
3. SI TE ENVIAN UNA IMAGEN, ANALÍZALA Y BRINDA DETALLES O SUGERENCIAS ÚTILES.
4. NUNCA MUESTRES TUS PENSAMIENTOS INTERNOS NI TEXTO EN INGLÉS COMO "Plan:" O "The user said".`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawApiKey = Deno.env.get("GEMINI_API_KEY") || "";
    const apiKey = rawApiKey.trim();

    if (!apiKey) {
      return new Response(
        JSON.stringify({ reply: "Error: No se encontró la API Key en los Secrets (GEMINI_API_KEY) de Supabase." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { prompt, message, history = [], image } = await req.json();
    const userMessage = prompt || message || "";

    if (!userMessage && !image) {
      return new Response(
        JSON.stringify({ reply: "Por favor escribe un mensaje o envía una imagen." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Consultar dinámicamente modelos habilitados en la cuenta/clave de Google Gemini
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const listData = await listRes.json();

    if (!listRes.ok || listData.error) {
      return new Response(
        JSON.stringify({ reply: `Error de Google Gemini API Key: ${listData?.error?.message || 'Verifica tu GEMINI_API_KEY'}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const availableModels = (listData.models || [])
      .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent") && !m.name.includes("deprecated"))
      .map((m: any) => m.name);

    if (availableModels.length === 0) {
      return new Response(
        JSON.stringify({ reply: "Error: No se encontró ningún modelo habilitado para tu API Key en Gemini." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Construir historial de conversación
    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        contents.push({
          role: msg.role === "assistant" || msg.role === "model" ? "model" : "user",
          parts: [{ text: msg.text || msg.content || "" }]
        });
      }
    }

    // Construir partes del mensaje actual
    const currentParts: any[] = [];
    if (userMessage) {
      currentParts.push({ text: userMessage });
    }

    if (image && image.data) {
      const mimeType = image.mimeType || "image/png";
      const cleanBase64 = image.data.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
      currentParts.push({
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64
        }
      });
    }

    contents.push({
      role: "user",
      parts: currentParts
    });

    const payload = {
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800
      }
    };

    // 3. Probar modelos disponibles secuencialmente hasta obtener respuesta exitosa
    let geminiRes: Response | null = null;
    let aiData: any = null;

    for (const modelName of availableModels) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`;

      try {
        const res = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok && !data.error) {
          geminiRes = res;
          aiData = data;
          break;
        } else {
          console.warn(`Error probando modelo ${modelName}:`, data.error?.message);
        }
      } catch (e) {
        console.warn(`Excepción conectando a ${modelName}:`, e);
      }
    }

    if (!geminiRes || !aiData) {
      return new Response(
        JSON.stringify({ reply: "No se pudo obtener respuesta de Google Gemini. Verifica los permisos de tu API Key." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const candidate = aiData.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    let rawTextReply = parts.map((p: any) => p.text || "").join("").trim();

    if (!rawTextReply) {
      rawTextReply = "¡Listo! ¿En qué más te puedo ayudar?";
    }

    return new Response(
      JSON.stringify({ reply: rawTextReply }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ reply: "Error interno en Edge Function: " + err.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
