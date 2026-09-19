// Supabase Edge Function: gemini-chat
// Handles AI Chatbot requests using Google Gemini API for Menutech.
// Compatible with Supabase Web Dashboard Edge Function editor & Deno runtime.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_INSTRUCTION = `Eres la Inteligencia Artificial oficial de Menutech (Menutech Bot) encargada de responder dudas sobre la plataforma, servicios y soporte de restaurantes.

REGLAS ABSOLUTAS E INVIOLABLES:
1. RESPONDE SIEMPRE Y ÚNICAMENTE EN ESPAÑOL, DE FORMA CONCISA, DIRECTA, AMABLE Y PROFESIONAL.
2. ESTÁ ESTRICTAMENTE PROHIBIDO MOSTRAR PENSAMIENTOS INTERNOS, LISTAS DE VERIFICACIÓN, PASOS DE RAZONAMIENTO, NOTAS EN INGLÉS O BULLETS COMO "* Spanish? Yes.", "* Direct/Professional/Short? Yes.", "The user said", "Plan:".
3. NO INCLUYAS COMILLAS DOBLES NI COMILLAS SIMPLES ALREDEDOR DE TU RESPUESTA FINAL. NO REPITAS LA RESPUESTA DOS VECES.
4. RESPONDE DIRECTAMENTE AL USUARIO CON LA RESPUESTA FINAL LISTA PARA LEER.
5. PUEDES RESPONDER PREGUNTAS SOBRE:
   - Menús digitales interactivos y Códigos QR.
   - Diseñador 3D de camisetas y personalización.
   - Impresión de tickets e impresoras térmicas.
   - Configuración de restaurantes, galerías y sitios web de Menutech.
6. SI TE SALUDAN (ej. "hola"), RESPONDE ÚNICAMENTE UN SALUDO CORTO Y DIRECTO (ej. "¡Hola! ¿En qué puedo ayudarte hoy con la plataforma Menutech?").`;

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

    // Helper function to thoroughly sanitize and clean Gemini output
    function cleanGeminiReply(text: string): string {
      if (!text) return "¡Hola! ¿En qué puedo ayudarte hoy con la plataforma Menutech?";

      let cleaned = text;

      // 1. Remove markdown code blocks if any (e.g. ```text ... ```)
      cleaned = cleaned.replace(/```[\s\S]*?```/g, "");

      // 2. Remove checklist bullets like "* Spanish? Yes." or "* Direct/Professional/Short? Yes."
      cleaned = cleaned.replace(/^\s*\*.*?\?.*$/gm, "");
      cleaned = cleaned.replace(/^\s*\*.*?\b(Yes|No|Si|No)\b.*$/gm, "");

      // 3. Filter lines containing known reasoning artifacts
      const lines = cleaned
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => {
          if (!l) return false;
          if (l.startsWith("*") && (l.includes("?") || l.includes("Yes") || l.includes("No"))) return false;
          if (l.toLowerCase().includes("the user said") || l.toLowerCase().includes("plan:")) return false;
          return true;
        });

      if (lines.length > 0) {
        cleaned = lines.join(" ");
      }

      // 4. Clean outer quotes if the entire string or candidate response was wrapped in quotes
      cleaned = cleaned.trim();

      // Check for repeated quotes e.g. "Hola...""Hola..." or "Hola..." "Hola..."
      const doubleQuoteMatches = cleaned.match(/"([^"]+)"/g);
      if (doubleQuoteMatches && doubleQuoteMatches.length > 0) {
        // Pick the longest unique quoted phrase or the last one
        const extracted = doubleQuoteMatches.map((m) => m.replace(/^"|"$/g, "").trim());
        cleaned = extracted[extracted.length - 1] || cleaned;
      } else {
        cleaned = cleaned.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();
      }

      // 5. De-duplicate repeated identical sentences if model outputs the answer twice
      const sentences = cleaned.split(/(?<=[.!?])\s+/);
      if (sentences.length >= 2 && sentences[0] === sentences[1]) {
        cleaned = sentences[0];
      }

      return cleaned.trim() || "¡Hola! ¿En qué puedo ayudarte hoy con la plataforma Menutech?";
    }

    const finalReply = cleanGeminiReply(rawTextReply);

    return new Response(
      JSON.stringify({ reply: finalReply }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ reply: "Error interno: " + err.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
