// Supabase Edge Function: gemini-chat
// Handles AI Chatbot requests using Google Gemini API with multimodal (text + image) support.
// Compatible with Supabase Web Dashboard Edge Function editor & Deno runtime.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_INSTRUCTION = `Eres el asistente virtual con IA de Menutech (Menutech Bot).
Tu trabajo es atender amablemente a los usuarios, dueños de restaurantes y clientes.
Puedes responder preguntas sobre los servicios de Menutech:
- Menús digitales interactivos y QR
- Personalización de páginas web para restaurantes (Deluxe / Template Web)
- Sistema de pedidos y reservas en tiempo real
- Impresión de tickets e impresoras térmicas
- Diseñador 3D de camisetas y productos
Responde siempre de forma educada, breve, profesional y servicial. Si te envían una imagen, analízala minuciosamente y da respuestas útiles referentes a menús, platillos o diseños.`;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawApiKey = Deno.env.get("GEMINI_API_KEY");
    const apiKey = rawApiKey ? rawApiKey.trim() : "";

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY environment variable is not configured in Supabase Web Dashboard Secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { prompt, history = [], image } = await req.json();

    if (!prompt && !image) {
      return new Response(
        JSON.stringify({ error: "Message prompt or image is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build contents payload for Gemini API
    const contents = [];

    // Add conversation history if present
    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        contents.push({
          role: msg.role === "assistant" || msg.role === "model" ? "model" : "user",
          parts: [{ text: msg.text || msg.content || "" }]
        });
      }
    }

    // Current user input parts
    const currentParts = [];

    if (prompt) {
      currentParts.push({ text: prompt });
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

    // Gemini API Request Payload
    const geminiPayload = {
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800,
      }
    };

    // Standard Gemini 1.5 Flash Endpoint (Supports all key formats: AQ.A..., AIza...)
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    let geminiRes = await fetch(geminiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(geminiPayload),
    });

    // Fallback to gemini-1.5-pro if 1.5-flash returns 404
    if (geminiRes.status === 404) {
      const fallbackEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
      geminiRes = await fetch(fallbackEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(geminiPayload),
      });
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API Error:", errText);
      return new Response(
        JSON.stringify({ error: "Error communicating with Gemini API", details: errText }),
        { status: geminiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiData = await geminiRes.json();
    const candidate = geminiData?.candidates?.[0];
    const replyText = candidate?.content?.parts?.map((p: { text?: string }) => p.text).join("") || "No response received.";

    return new Response(
      JSON.stringify({ reply: replyText }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
