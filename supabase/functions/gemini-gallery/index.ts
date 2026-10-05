// ====================================================================
// SUPABASE EDGE FUNCTION PARA GEMINI GALLERY AI (gemini-gallery/index.ts)
// ====================================================================
// Standalone Edge Function in Deno TypeScript specialized for Gemini AI
// image handling, brand asset collection, and automated Cloudinary gallery persistence.
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
  image?: string | { mimeType?: string; data?: string };
  image_url?: string;
  image_base64?: string;
  image_mime?: string;
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
      console.warn("Cloudinary upload failed in gemini-gallery function:", await res.text());
      return null;
    }

    const data = await res.json();
    const secureUrl = data.secure_url;

    if (secureUrl && userId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || "https://eemqyrysdgasfjlitads.supabase.co";
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || "";

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

// Clean and sanitize AI response
function sanitizeAIResponse(text: string): string {
  if (!text) return '';
  let clean = text;
  clean = clean.replace(/<(thought|think)[\s\S]*?<\/\1>/gi, '');
  clean = clean.replace(/(question \d+:|knowledge areas:|steps \(|self-correction|drafting:|persona:|constraint:)[\s\S]*?(?=\n\n[A-Z¡¿"']|Para |El |Hola |$)/gi, '');
  clean = clean.replace(/```json[\s\S]*?```/gi, '').replace(/```[\s\S]*?```/gi, '').trim();
  return clean;
}

// Discover available Gemini models dynamically
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
              if (!foundModels.includes(nameOnly)) foundModels.push(nameOnly);
            }
          }
        }
      }
    } catch (e) {
      console.warn(`Error discovering models in ${ver}:`, e);
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
      history,
      image,
      image_url,
      image_base64,
      image_mime = 'image/jpeg',
      userSession
    } = body;

    const userPrompt = (prompt || message || '').trim();
    const historyInput = history || [];

    const apiKey = (
      Deno.env.get('GEMINI_API_KEY') ||
      Deno.env.get('Spirit') ||
      Deno.env.get('OPENAI_API_KEY') ||
      ''
    ).trim();

    if (!apiKey) {
      return new Response(
        JSON.stringify({ reply: 'Error: No Gemini API Key configured in server environment.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const candidateModels = await discoverAvailableGeminiModels(apiKey);
    const contents: GeminiContent[] = [];

    if (Array.isArray(historyInput) && historyInput.length > 0) {
      for (const turn of historyInput) {
        if (!turn || typeof turn !== 'object') continue;
        const role = turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user';
        let parts: GeminiPart[] = [];
        if (Array.isArray(turn.parts)) parts = turn.parts;
        else if (typeof turn.content === 'string') parts = [{ text: turn.content }];
        else if (typeof turn.text === 'string') parts = [{ text: turn.text }];

        const validParts = parts.filter(p => p && (p.text !== undefined || p.inlineData !== undefined));
        if (validParts.length === 0) continue;

        if (contents.length > 0 && contents[contents.length - 1].role === role) {
          contents[contents.length - 1].parts.push(...validParts);
        } else {
          contents.push({ role, parts: [...validParts] });
        }
      }
    }

    const currentParts: GeminiPart[] = [];
    let rawImageData: string | undefined;
    let mimeType = image_mime || 'image/jpeg';

    if (typeof image === 'string') rawImageData = image;
    else if (image && typeof image === 'object') {
      if (image.mimeType) mimeType = image.mimeType;
      if (image.data) rawImageData = image.data;
    }
    if (!rawImageData) rawImageData = image_base64 || image_url;

    if (rawImageData && typeof rawImageData === 'string') {
      let cleanBase64 = rawImageData;
      if (rawImageData.includes('base64,')) {
        const header = rawImageData.substring(0, rawImageData.indexOf('base64,'));
        if (header.includes(':') && header.includes(';')) {
          mimeType = header.substring(header.indexOf(':') + 1, header.indexOf(';')) || mimeType;
        }
        cleanBase64 = rawImageData.split('base64,')[1];
      }

      currentParts.push({ inlineData: { mimeType, data: cleanBase64 } });
    }

    if (userPrompt) currentParts.push({ text: userPrompt });

    // Upload image to Cloudinary & register in Supabase galeria table if user session is present
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
      systemText = `You are Menutech AI, an intelligent, enthusiastic, and creative virtual assistant specializing in restaurant branding, media, and gallery management.

STRICT LANGUAGE RULE FOR CLIENTS/OWNERS:
- ALWAYS speak and respond to the client strictly in English (en-US). Never address the client in Spanish.

GALLERY & BRAND ASSET PROMPTING INSTRUCTIONS:
- Actively, naturally, and dynamically encourage the client to share or upload photos and images for their account gallery and brand assets.
- Formulate creative, context-aware requests in English such as:
  * "Upload an image and I will save it directly to your gallery!"
  * "Give me photos to elevate your brand or provide your designer with more material for your website, social media, and advertising!"
  * "Feel free to pass me photos anytime—I'll make sure they are saved right into your restaurant gallery!"
- NEVER rely on a static or hardcoded phrase. Generate natural, contextual English sentences according to the flow of conversation.
${uploadedGalleryUrl ? `- IMPORTANT: An image sent by the client was JUST successfully uploaded to Cloudinary (${uploadedGalleryUrl}) and saved to their gallery in Restaurant Info. Inform the client enthusiastically in English that their photo has been saved to their gallery!` : ''}

GENERAL RULES:
1. Speak naturally and politely in English.
2. NEVER output internal reasoning, thought blocks, or meta-comments.
3. If an image is sent, analyze it accurately and confirm its gallery saving.`;
    } else {
      systemText = `Eres Menutech AI, una Inteligencia Artificial especialista en galerías, desarrollo web y assets de restaurantes.

REGLAS ABSOLUTAS PARA EQUIPO INTERNO (ADMIN / DISEÑO / CS / DEVELOPER):
1. Hablas SIEMPRE Y ÚNICAMENTE en español de forma natural, fluida, cercana, clara y directa.
2. Orienta al usuario en español sobre la gestión de imágenes y galerías.
${uploadedGalleryUrl ? `- NOTA: La imagen adjunta fue subida exitosamente a Cloudinary (${uploadedGalleryUrl}) y guardada en la galería del restaurante.` : ''}`;
    }

    const systemInstruction = { parts: [{ text: systemText }] };

    let geminiRes: Response | null = null;
    let aiData: any = null;
    let lastApiError = '';

    for (const modelName of candidateModels) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      try {
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction,
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
          })
        });

        const data = await res.json();
        if (res.ok && data.candidates && data.candidates.length > 0) {
          geminiRes = res;
          aiData = data;
          break;
        } else if (data.error && data.error.message) {
          lastApiError = `[${modelName}] ${data.error.message}`;
        }
      } catch (e: any) {
        lastApiError = `[${modelName}] ${e.message}`;
      }
    }

    if (!geminiRes || !aiData) {
      return new Response(
        JSON.stringify({ reply: `Service communication error: ${lastApiError || 'No model response.'}` }),
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
      JSON.stringify({
        reply: cleanReply || 'Image received and gallery updated.',
        image_url: uploadedGalleryUrl,
        saved_to_gallery: !!uploadedGalleryUrl
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ reply: 'Edge Function internal error: ' + error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
