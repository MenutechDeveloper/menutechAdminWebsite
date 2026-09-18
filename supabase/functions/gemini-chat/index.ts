// Supabase Edge Function: gemini-chat
// Handles AI Chatbot requests using Google Gemini API for Menutech.
// Compatible with Supabase Web Dashboard Edge Function editor & Deno runtime.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_INSTRUCTION = `Eres la Inteligencia Artificial de Menutech (Menutech Bot) encargada de responder dudas sobre la plataforma, servicios y soporte de restaurantes.

REGLAS OBLIGATORIAS DE RESPUESTA:
1. RESPONDE SIEMPRE EN ESPAÑOL DE FORMA DIRECTA, PROFESIONAL Y CORTA.
2. NUNCA MUESTRES TUS PENSAMIENTOS INTERNOS, PASOS DE RAZONAMIENTO NI NADA EN INGLÉS COMO "The user said", "Plan:".
3. PUEDES RESPONDER PREGUNTAS SOBRE:
   - Menús digitales interactivos y Códigos QR.
   - Diseñador 3D de camisetas y personalización.
   - Impresión de tickets e impresoras térmicas.
   - Configuración de restaurantes, galerías y sitios web.
4. SI TE PREGUNTAN ALGO MATEMÁTICO O UNA DUDA DIRECTA (ej. "¿Cuánto es 2 + 2?"), RESPONDE SOLAMENTE EL RESULTADO O UNA EXPLICACIÓN ULTRA CORTA (ej. "4").`;

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

    // 1. Consultar modelos habilitados en la API Key
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const listData = await listRes.json();

    if (!listRes.ok || listData.error) {
      return new Response(
        JSON.stringify({ reply: `Error de Google Gemini: ${listData?.error?.message || 'API Key inválida'}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const availableModels = (listData.models || [])
      .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent") && !m.name.includes("deprecated"))
      .map((m: any) => m.name);

    if (availableModels.length === 0) {
      return new Response(
        JSON.stringify({ reply: "Error: No se encontró ningún modelo habilitado para tu API Key en Google Gemini." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Construir contenidos y partes
    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        contents.push({
          role: msg.role === "assistant" || msg.role === "model" ? "model" : "user",
          parts: [{ text: msg.text || msg.content || "" }]
        });
      }
    }

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

    // 3. Consultar modelos disponibles secuencialmente
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
        }
      } catch (e) {
        console.warn(`Error consultando ${modelName}:`, e);
      }
    }

    if (!geminiRes || !aiData) {
      return new Response(
        JSON.stringify({ reply: "Error al comunicarse con la IA de Google Gemini." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const candidate = aiData.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    let rawTextReply = parts.map((p: any) => p.text || "").join("").trim();

    if (rawTextReply.includes("The user said") || rawTextReply.includes("Plan:")) {
      const lines = rawTextReply.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      rawTextReply = lines[lines.length - 1] || "¡Listo!";
    }

    return new Response(
      JSON.stringify({ reply: rawTextReply || "¡Listo! ¿En qué más te colaboro?" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ reply: "Error interno: " + err.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
