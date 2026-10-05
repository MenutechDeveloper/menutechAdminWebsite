// ====================================================================
// SUPABASE EDGE FUNCTION PARA GEMINI AI (gemini-chat/index.ts)
// ====================================================================
// Asistente virtual en español basado en Google Gemini AI (estilo ChatGPT).
// Características principales:
// 1. Detección dinámica de modelos de Google Gemini vía ListModels API.
// 2. Respuesta abierta a cualquier consulta general (conocimiento universal).
// 3. Conversación fluida de varios turnos (multi-turn history).
// 4. Análisis de imágenes multimodal (visión por computadora).
// 5. Sanitización y filtrado de respuestas para eliminar pensamientos internos (<think>).
// ====================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface RequestBody {
  prompt?: string;
  message?: string;
  history?: Array<{ role: string; content?: string; text?: string; parts?: any[] }>;
  conversation_history?: Array<{ role: string; content?: string; text?: string; parts?: any[] }>;
  image?: string | { mimeType?: string; data?: string };
  image_url?: string;
  image_base64?: string;
  image_mime?: string;
  is_proactive?: boolean;
  userSession?: {
    id?: string;
    email?: string;
    role?: string;
    username?: string;
    domain?: string;
  };
}

// Upload image to Cloudinary and insert record into Supabase galeria table
async function saveImageToCloudinaryAndGallery(rawImageData: string, userId: string, domain?: string): Promise<string | null> {
  try {
    const cloudName = "dzklt0a5u";
    const uploadPreset = "Menutech";

    let cleanBase64 = rawImageData;
    if (cleanBase64.includes('base64,')) {
      cleanBase64 = cleanBase64.split('base64,')[1];
    }

    const formData = new FormData();
    formData.append("file", `data:image/jpeg;base64,${cleanBase64}`);
    formData.append("upload_preset", uploadPreset);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      console.warn("Cloudinary upload failed in edge function:", await res.text());
      return null;
    }

    const data = await res.json();
    const secureUrl = data.secure_url;

    if (secureUrl && userId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || "https://eemqyrysdgasfjlitads.supabase.co";
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlbXF5cnlzZGdhc2ZqbGl0YWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MjA0NDUsImV4cCI6MjA4OTI5NjQ0NX0.UiyZLqhXSQ1Z_FoL006PDrDYKXbr_pxCOugYTulhdPY";

      await fetch(`${supabaseUrl}/rest/v1/galeria`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          user_id: userId,
          domain: domain || 'undetermined',
          image_url: secureUrl,
          created_at: new Date().toISOString()
        })
      });
    }

    return secureUrl;
  } catch (err) {
    console.warn("Error uploading image to Cloudinary & galeria:", err);
    return null;
  }
}

// Limpieza y sanitización estricta de las respuestas devueltas por el modelo
function sanitizeAIResponse(text: string): string {
  if (!text) return '';
  let clean = text;

  // 1. Eliminar bloques de pensamiento o borradores <thought> o <think>
  clean = clean.replace(/<(thought|think)[\s\S]*?<\/\1>/gi, '');

  // 2. Eliminar secciones de desglose de preguntas, borradores en inglés o razonamientos internos
  clean = clean.replace(/(question \d+:|knowledge areas:|steps \(|self-correction|drafting:|persona:|constraint:|\"como se hace|\"how to make)[\s\S]*?(?=\n\n[A-Z¡¿"']|Para |El |Hola |¡Hola |$)/gi, '');

  // 3. Eliminar prefijos de razonamiento o etiquetas internas
  clean = clean.replace(/(pensamiento|thought|reasoning|proceso de pensamiento):[\s\S]*?(?=\n\n|\n[A-Z¡¿"']|$)/gi, '');

  // 4. Filtrar líneas de metadatos o viñetas internas
  const lines = clean.split('\n');
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    if (trimmed.startsWith('*') && (
      lower.includes('user input') ||
      lower.includes('persona') ||
      lower.includes('constraint') ||
      lower.includes('thought') ||
      lower.includes('direct answer') ||
      lower.includes('reasoning') ||
      lower.includes('pensamiento') ||
      lower.includes('spanish')
    )) {
      return false;
    }
    return true;
  });

  clean = filtered.join('\n').trim();

  // 5. Eliminar bloques json envolventes si existieran
  clean = clean.replace(/```json[\s\S]*?```/gi, '').replace(/```[\s\S]*?```/gi, '').trim();

  return clean;
}

// Descubrimiento dinámico de modelos disponibles vía ListModels API
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
    return [
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ];
  }

  // Ordenar priorizando modelos flash rápidos
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
      history,
      conversation_history,
      image,
      image_url,
      image_base64,
      image_mime = 'image/jpeg',
      is_proactive = false,
      userSession
    } = body;

    if (is_proactive) {
      return new Response(JSON.stringify({ should_notify: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const userPrompt = (prompt || message || '').trim();
    const historyInput = history || conversation_history || [];

    const apiKey = (
      Deno.env.get('GEMINI_API_KEY') ||
      Deno.env.get('Spirit') ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''
    ).trim();

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          reply: 'Error: No se encontró la API Key de Gemini en las variables del servidor (GEMINI_API_KEY / Spirit).'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!userPrompt && !image && !image_url && !image_base64 && historyInput.length === 0) {
      return new Response(
        JSON.stringify({ reply: '¡Hola! ¿En qué te puedo ayudar o de qué te gustaría platicar hoy?' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const candidateModels = await discoverAvailableGeminiModels(apiKey);
    const contents: GeminiContent[] = [];

    // Sanitizar historial de conversación asegurando alternancia de roles (user / model)
    if (Array.isArray(historyInput) && historyInput.length > 0) {
      for (const turn of historyInput) {
        if (!turn || typeof turn !== 'object') continue;
        const role = turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user';
        let parts: GeminiPart[] = [];

        if (Array.isArray(turn.parts)) {
          parts = turn.parts;
        } else if (typeof turn.content === 'string') {
          parts = [{ text: turn.content }];
        } else if (typeof turn.text === 'string') {
          parts = [{ text: turn.text }];
        }

        const validParts = parts.filter(p => p && (p.text !== undefined || p.inlineData !== undefined));
        if (validParts.length === 0) continue;

        if (contents.length > 0 && contents[contents.length - 1].role === role) {
          contents[contents.length - 1].parts.push(...validParts);
        } else {
          contents.push({ role, parts: [...validParts] });
        }
      }
    }

    // Preparar el turno actual
    const currentParts: GeminiPart[] = [];

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

    if (rawImageData && typeof rawImageData === 'string') {
      let cleanBase64 = rawImageData;

      if (rawImageData.includes('base64,')) {
        const header = rawImageData.substring(0, rawImageData.indexOf('base64,'));
        if (header.includes(':') && header.includes(';')) {
          mimeType = header.substring(header.indexOf(':') + 1, header.indexOf(';')) || mimeType;
        }
        cleanBase64 = rawImageData.split('base64,')[1];
      }

      currentParts.push({
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64
        }
      });
    }

    if (userPrompt) {
      currentParts.push({ text: userPrompt });
    }

    // Check if an image was provided and save it to Cloudinary & galeria table if user is available
    let uploadedGalleryUrl: string | null = null;
    if (rawImageData && userSession && userSession.id) {
      uploadedGalleryUrl = await saveImageToCloudinaryAndGallery(rawImageData, userSession.id, userSession.domain);
    }

    if (currentParts.length > 0) {
      if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
        contents[contents.length - 1].parts.push(...currentParts);
      } else {
        contents.push({ role: 'user', parts: currentParts });
      }
    }

    const userRole = ((userSession && userSession.role) || 'owner').trim().toLowerCase();
    const nonOwnerRoles = ['admin', 'developer', 'cs', 'admincs', 'designer', 'disenador', 'retention'];
    const isOwner = !nonOwnerRoles.includes(userRole) && userRole !== 'admin';

    let systemText = '';

    if (isOwner) {
      systemText = `You are Menutech AI, an intelligent, helpful, and friendly virtual assistant for restaurant owners and clients.

STRICT LANGUAGE RULE FOR CLIENTS/OWNERS:
- ALWAYS talk and respond to the client strictly in English (en-US). Never address the client in Spanish.

GALLERY & BRAND ASSET PROMPTING INSTRUCTIONS:
- Actively, naturally, and dynamically ask the client to provide or upload images for their account gallery and brand assets.
- Formulate creative, context-aware requests in English such as:
  * "Upload an image and I will save it directly to your gallery!"
  * "Give me photos to elevate your brand or provide your designer with more material for your website and advertising!"
  * "Feel free to send me images anytime—I'll make sure they are stored safely in your restaurant gallery!"
- NEVER rely on a rigid static phrase. Always generate natural, contextual English sentences according to the flow of conversation.
${uploadedGalleryUrl ? `- IMPORTANT: An image sent by the client was JUST successfully uploaded to Cloudinary (${uploadedGalleryUrl}) and saved to their gallery in Restaurant Info. Inform the client enthusiastically in English that their photo has been saved to their gallery!` : ''}

GENERAL RULES:
1. Speak naturally and politely in English.
2. NEVER output internal reasoning, thought blocks, or meta-comments.
3. If the user attaches an image, analyze it accurately and confirm its gallery saving.`;
    } else {
      systemText = `Eres Menutech AI, una Inteligencia Artificial extraordinariamente inteligente, capaz, brillante, empática, alegre y atenta (al estilo de ChatGPT / Gemini).
Tienes conocimientos amplios sobre desarrollo web, restaurantes, menú digital, soporte y administración.

REGLAS ABSOLUTAS PARA EQUIPO INTERNO (ADMIN / DISEÑO / CS / DEVELOPER):
1. Hablas SIEMPRE Y ÚNICAMENTE en español de forma natural, fluida, cercana, clara y directa.
2. Queda STRICTAMENTE PROHIBIDO incluir pensamientos internos, notas de razonamiento, traducciones al inglés, borradores de pasos, desgloses de preguntas o metacomentarios.
3. Si el usuario te pide ayuda con galerías o imágenes de restaurantes, oriéntalo en español sobre la gestión de marca y assets.
${uploadedGalleryUrl ? `- NOTA: La imagen adjunta fue subida exitosamente a Cloudinary (${uploadedGalleryUrl}) y guardada en la galería del restaurante.` : ''}
4. NUNCA respondas con plantillas ni mensajes evasivos. RESPONDE DE UNA VEZ LA CONSULTA COMPLETA.`;
    }

    const systemInstruction = {
      parts: [
        {
          text: systemText
        }
      ]
    };

    let geminiRes: Response | null = null;
    let aiData: any = null;
    let lastApiError: string = '';

    for (const modelName of candidateModels) {
      const apiVersion = 'v1beta';
      const geminiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;

      const generationConfig: Record<string, any> = {
        temperature: 0.7,
        maxOutputTokens: 2048
      };

      try {
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction,
            contents,
            generationConfig
          })
        });

        const data = await res.json();
        if (res.ok && data.candidates && data.candidates.length > 0) {
          geminiRes = res;
          aiData = data;
          break;
        } else if (data.error && data.error.message) {
          lastApiError = `[${modelName}] ${data.error.message}`;
          console.warn(`Intento fallido con modelo ${modelName}:`, data.error.message);
        }
      } catch (e: any) {
        lastApiError = `[${modelName}] ${e.message}`;
        console.warn(`Excepción llamando a ${modelName}:`, e);
      }
    }

    if (!geminiRes || !aiData) {
      return new Response(
        JSON.stringify({
          reply: `Lo siento, ocurrió un inconveniente de comunicación con el servicio de IA. Detalle: ${lastApiError || 'Sin respuesta de modelos.'}`
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const candidate = aiData.candidates?.[0];
    const resParts = candidate?.content?.parts || [];
    let rawReply = '';

    for (const part of resParts) {
      if (part.text) rawReply += part.text;
    }

    const cleanReply = sanitizeAIResponse(rawReply);

    return new Response(
      JSON.stringify({ reply: cleanReply || 'No pude generar una respuesta clara en este momento.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ reply: 'Error interno en la Edge Function: ' + error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
