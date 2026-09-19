// Supabase Edge Function: gemini-chat
// Handles AI Chatbot requests using Google Gemini API & Supabase Database Operations for Menutech.
// Compatible with Deno runtime and Supabase Gateway.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_INSTRUCTION_BASE = `Eres la Inteligencia Artificial oficial de Menutech (Menutech Bot) encargada de responder dudas sobre la plataforma, servicios y soporte de restaurantes, además de ayudar a administrar y editar los menús digitales de los clientes.

REGLAS ABSOLUTAS E INVIOLABLES:
1. RESPONDE SIEMPRE Y ÚNICAMENTE EN ESPAÑOL, DE FORMA CONCISA, DIRECTA, AMABLE Y PROFESIONAL.
2. ESTÁ ESTRICTAMENTE PROHIBIDO MOSTRAR PENSAMIENTOS INTERNOS, LISTAS DE VERIFICACIÓN, PASOS DE RAZONAMIENTO, NOTAS EN INGLÉS O BULLETS COMO "* Spanish? Yes.", "* Direct/Professional/Short? Yes.", "The user said", "Plan:".
3. NO INCLUYAS COMILLAS DOBLES NI COMILLAS SIMPLES ALREDEDOR DE TU RESPUESTA FINAL. NO REPITAS LA RESPUESTA DOS VECES.
4. RESPONDE DIRECTAMENTE AL USUARIO CON LA RESPUESTA FINAL LISTA PARA LEER.
5. PUEDES EDITAR LOS MENÚS (crear categorías, agregar platillos, actualizar precios, modificar descripciones, eliminar platillos o categorías específicas).
6. REGLA DE SEGURIDAD DE ELIMINACIÓN: ESTÁ ESTRICTAMENTE PROHIBIDO ELIMINAR TODO EL MENÚ O BORRAR TODAS LAS CATEGORÍAS DE GOLPE. Si el usuario te pide "elimina todo", "borra el menú completo", o cualquier acción de borrado masivo, debes negarte educadamente explicando que solo puedes eliminar platillos o categorías individuales una por una.
7. CONTROL DE ACCESO SEGÚN EL ROL DEL USUARIO:
   - Si el usuario es 'OWNER' (cliente/propietario): Solo puede editar las cosas de su propia cuenta. Si un 'OWNER' te pide ir o editar la cuenta de otro cliente (ej. "ve a la cuenta de La Salsita Pinchi"), debes informarle amablemente que solo tiene permisos para modificar el menú de su propia cuenta.
   - Si el usuario es 'ADMIN', 'DEVELOPER', 'CS', 'ADMINCS', 'ADMINDESIGN', etc. (cualquiera menos 'OWNER'): Tienen permisos globales para buscar usuarios/restaurantes por nombre o dominio y editar sus menús.
8. SI TE SALUDAN (ej. "hola"), RESPONDE ÚNICAMENTE UN SALUDO CORTO Y DIRECTO (ej. "¡Hola! ¿En qué puedo ayudarte hoy con tu menú de Menutech?").`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawApiKey = Deno.env.get("GEMINI_API_KEY") || "";
    const apiKey = rawApiKey.trim();

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://eemqyrysdgasfjlitads.supabase.co";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!apiKey) {
      return new Response(
        JSON.stringify({ reply: "Error: No se encontró la API Key en los Secrets (GEMINI_API_KEY) de Supabase." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { prompt, message, history = [], image, userSession = null } = await req.json();
    const userMessage = prompt || message || "";

    if (!userMessage && !image) {
      return new Response(
        JSON.stringify({ reply: "Por favor escribe un mensaje o envía una imagen." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine current user details & role
    const userRole = (userSession?.role || 'owner').trim().toLowerCase();
    const isOwner = userRole === 'owner';
    const userId = userSession?.id || null;
    const userDomain = userSession?.domain || '';

    // Fetch Learned Knowledge Base Context from menutech_knowledge table
    let learnedKnowledgeText = "";
    try {
      const { data: knowledgeList } = await supabase
        .from('menutech_knowledge')
        .select('title, type, content')
        .limit(20);

      if (knowledgeList && knowledgeList.length > 0) {
        learnedKnowledgeText = "\n\nCONOCIMIENTOS APRENDIDOS DE LA PLATAFORMA (MENUTECH KNOWLEDGE):\n" +
          knowledgeList.map((k: any) => `-[${k.type.toUpperCase()}] ${k.title}: ${k.content}`).join("\n");
      }
    } catch (e) {
      console.warn("Error fetching learned knowledge:", e);
    }

    // Check for safety rule: prohibit mass deletion
    const lowerUserMsg = userMessage.toLowerCase();
    if (lowerUserMsg.includes("elimina todo") || lowerUserMsg.includes("borra todo") || lowerUserMsg.includes("vaciar menu") || lowerUserMsg.includes("borrar todo")) {
      return new Response(
        JSON.stringify({ reply: "Por seguridad, no tengo permitido eliminar todo el menú de golpe. Puedo ayudarte a eliminar platillos o categorías individuales uno por uno si me indicas cuáles deseas borrar." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for role-based cross-account editing restrictions for OWNER
    if (isOwner && (lowerUserMsg.includes("cuenta de") || lowerUserMsg.includes("ve a la cuenta") || lowerUserMsg.includes("entra a la cuenta") || lowerUserMsg.includes("cambia a la cuenta"))) {
      // Check if user is trying to switch to another account
      const currentUsername = (userSession?.username || '').toLowerCase();
      if (!lowerUserMsg.includes(currentUsername)) {
        return new Response(
          JSON.stringify({ reply: "Como usuario propietario de tu cuenta, solo tienes permisos para modificar el menú de tu propia cuenta. No es posible acceder o editar los menús de otros clientes." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 1. Fetch available models from Gemini API Key
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

    // Construct prompt context with session metadata
    let sessionInfoText = `\nDATOS DEL USUARIO ACTUAL EN SESIÓN:\n- ID: ${userId || 'No identificado'}\n- Rol: ${userRole.toUpperCase()}\n- Nombre: ${userSession?.username || 'Usuario'}\n- Dominio: ${userDomain || 'Sin dominio'}`;

    const systemInstructionCombined = SYSTEM_INSTRUCTION_BASE + sessionInfoText + learnedKnowledgeText;

    // Helper functions for menu CRUD against Supabase
    async function resolveTargetUserId(targetAccountName?: string): Promise<{ targetId: string; accountName: string } | null> {
      if (isOwner) {
        if (!userId) return null;
        return { targetId: userId, accountName: userSession?.username || 'tu cuenta' };
      }

      if (targetAccountName) {
        const term = targetAccountName.toLowerCase().trim();
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, domain, email');

        if (profiles && profiles.length > 0) {
          const match = profiles.find((p: any) =>
            (p.username || '').toLowerCase().includes(term) ||
            (p.domain || '').toLowerCase().includes(term) ||
            (p.email || '').toLowerCase().includes(term)
          );
          if (match) {
            return { targetId: match.id, accountName: match.username || match.domain || match.email };
          }
        }
      }

      // Default fallback for admin if no name specified: use current user ID or first profile
      if (userId) {
        return { targetId: userId, accountName: userSession?.username || 'tu cuenta' };
      }
      return null;
    }

    async function getOrCreateMenu(targetId: string) {
      const { data: existingMenu } = await supabase
        .from('menutech_menus')
        .select('*')
        .eq('user_id', targetId)
        .maybeSingle();

      if (existingMenu) return existingMenu;

      // Fetch profile domain if available
      const { data: prof } = await supabase.from('profiles').select('domain, username').eq('id', targetId).maybeSingle();
      const domain = prof?.domain || 'undetermined';
      const slug = (prof?.domain || prof?.username || 'restaurant').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      const newMenu = {
        user_id: targetId,
        domain: domain,
        slug: slug,
        menu_style: 'mode2',
        cover_url: '',
        cover_type: 'image',
        config: { categories: [], toppings: [] }
      };

      const { data: inserted } = await supabase.from('menutech_menus').insert(newMenu).select().single();
      return inserted || newMenu;
    }

    // Direct Intent Action Handler (Executes CRUD based on prompt patterns or function calls)
    let actionPerformed = false;
    let actionReply = "";

    // Pattern Matching for Common Intent Commands
    const cleanMsgLower = userMessage.toLowerCase();

    // Search Account Command
    if (!isOwner && (cleanMsgLower.includes("buscar cuenta") || cleanMsgLower.includes("cuenta de") || cleanMsgLower.includes("ir a la cuenta"))) {
      const searchTerms = userMessage.replace(/.*(cuenta de|buscar cuenta|ir a la cuenta)\s*/i, "").trim();
      const resolved = await resolveTargetUserId(searchTerms);
      if (resolved) {
        const targetMenu = await getOrCreateMenu(resolved.targetId);
        const catCount = targetMenu.config?.categories?.length || 0;
        actionPerformed = true;
        actionReply = `He encontrado la cuenta de **${resolved.accountName}**. Tiene un menú activo con ${catCount} categoría(s). ¿Qué cambios o platillos deseas agregar o modificar?`;
      } else {
        actionPerformed = true;
        actionReply = `No pude encontrar ninguna cuenta que coincida con "${searchTerms}". Por favor verifica el nombre o dominio del cliente.`;
      }
    }

    // Add Category
    else if (cleanMsgLower.includes("crea la categoria") || cleanMsgLower.includes("crear categoria") || cleanMsgLower.includes("agrega la categoria") || cleanMsgLower.includes("nueva categoria")) {
      const catName = userMessage.replace(/.*(categoria|categoría)\s*/i, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
      if (catName) {
        const target = await resolveTargetUserId();
        if (target) {
          const menu = await getOrCreateMenu(target.targetId);
          const config = menu.config || { categories: [], toppings: [] };
          if (!config.categories) config.categories = [];

          const exists = config.categories.some((c: any) => c.name.toLowerCase() === catName.toLowerCase());
          if (!exists) {
            config.categories.push({
              name: catName,
              description: '',
              image: '',
              visibility: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', startDate: '', endDate: '' },
              dishes: []
            });

            await supabase.from('menutech_menus').upsert({
              user_id: target.targetId,
              domain: menu.domain || 'undetermined',
              slug: menu.slug || 'restaurant',
              menu_style: menu.menu_style || 'mode2',
              cover_url: menu.cover_url || '',
              cover_type: menu.cover_type || 'image',
              config: config
            }, { onConflict: 'user_id' });

            actionPerformed = true;
            actionReply = `¡Listo! He creado la nueva categoría **"${catName}"** en el menú de ${target.accountName}.`;
          } else {
            actionPerformed = true;
            actionReply = `La categoría **"${catName}"** ya existe en el menú.`;
          }
        }
      }
    }

    // Add Dish
    else if (cleanMsgLower.includes("agrega el platillo") || cleanMsgLower.includes("agregar platillo") || cleanMsgLower.includes("crear platillo") || cleanMsgLower.includes("nuevo platillo")) {
      // Extract dish name, price, category
      const priceMatch = userMessage.match(/\$?\s*(\d+(\.\d+)?)/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

      let dishName = userMessage
        .replace(/.*(platillo|platillos|agregar|agrega|crear)\s*/i, "")
        .replace(/\$?\s*\d+(\.\d+)?.*/, "")
        .replace(/en la categoria.*/i, "")
        .replace(/en la categoría.*/i, "")
        .replace(/^["'\s]+|["'\s]+$/g, "").trim();

      let targetCatName = "";
      const catMatch = userMessage.match(/en la categor[ií]a\s+["']?([^"'\n\.$]+)["']?/i);
      if (catMatch) {
        targetCatName = catMatch[1].trim();
      }

      if (dishName) {
        const target = await resolveTargetUserId();
        if (target) {
          const menu = await getOrCreateMenu(target.targetId);
          const config = menu.config || { categories: [], toppings: [] };
          if (!config.categories) config.categories = [];

          if (config.categories.length === 0) {
            config.categories.push({
              name: targetCatName || 'General',
              description: '',
              image: '',
              visibility: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', startDate: '', endDate: '' },
              dishes: []
            });
          }

          let catObj = targetCatName
            ? config.categories.find((c: any) => c.name.toLowerCase() === targetCatName.toLowerCase())
            : config.categories[0];

          if (!catObj) {
            catObj = {
              name: targetCatName || 'General',
              description: '',
              image: '',
              visibility: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', startDate: '', endDate: '' },
              dishes: []
            };
            config.categories.push(catObj);
          }

          if (!catObj.dishes) catObj.dishes = [];
          catObj.dishes.push({
            name: dishName,
            description: '',
            price: price,
            image: '',
            sizes: [],
            toppings: []
          });

          await supabase.from('menutech_menus').upsert({
            user_id: target.targetId,
            domain: menu.domain || 'undetermined',
            slug: menu.slug || 'restaurant',
            menu_style: menu.menu_style || 'mode2',
            cover_url: menu.cover_url || '',
            cover_type: menu.cover_type || 'image',
            config: config
          }, { onConflict: 'user_id' });

          actionPerformed = true;
          const priceText = price > 0 ? ` con un precio de $${price}` : '';
          actionReply = `¡Listo! He agregado el platillo **"${dishName}"**${priceText} en la categoría **"${catObj.name}"**.`;
        }
      }
    }

    // Update Price
    else if (cleanMsgLower.includes("actualiza el precio") || cleanMsgLower.includes("cambia el precio") || cleanMsgLower.includes("precio de")) {
      const priceMatch = userMessage.match(/\$?\s*(\d+(\.\d+)?)/);
      const newPrice = priceMatch ? parseFloat(priceMatch[1]) : null;

      let dishName = userMessage
        .replace(/.*(precio de|precio del platillo|precio a)\s*/i, "")
        .replace(/\$?\s*\d+(\.\d+)?.*/, "")
        .replace(/^["'\s]+|["'\s]+$/g, "").trim();

      if (dishName && newPrice !== null) {
        const target = await resolveTargetUserId();
        if (target) {
          const menu = await getOrCreateMenu(target.targetId);
          const config = menu.config || { categories: [], toppings: [] };
          let updated = false;

          (config.categories || []).forEach((cat: any) => {
            (cat.dishes || []).forEach((dish: any) => {
              if (dish.name.toLowerCase().includes(dishName.toLowerCase()) || dishName.toLowerCase().includes(dish.name.toLowerCase())) {
                dish.price = newPrice;
                updated = true;
              }
            });
          });

          if (updated) {
            await supabase.from('menutech_menus').upsert({
              user_id: target.targetId,
              domain: menu.domain || 'undetermined',
              slug: menu.slug || 'restaurant',
              menu_style: menu.menu_style || 'mode2',
              cover_url: menu.cover_url || '',
              cover_type: menu.cover_type || 'image',
              config: config
            }, { onConflict: 'user_id' });

            actionPerformed = true;
            actionReply = `¡Listo! He actualizado el precio del platillo **"${dishName}"** a **$${newPrice}**.`;
          } else {
            actionPerformed = true;
            actionReply = `No encontré ningún platillo llamado "${dishName}" en el menú para actualizar su precio.`;
          }
        }
      }
    }

    // Delete Single Dish
    else if (cleanMsgLower.includes("elimina el platillo") || cleanMsgLower.includes("borra el platillo") || cleanMsgLower.includes("quitar el platillo")) {
      let dishName = userMessage
        .replace(/.*(platillo|borra|elimina|quitar)\s*/i, "")
        .replace(/^["'\s]+|["'\s]+$/g, "").trim();

      if (dishName) {
        const target = await resolveTargetUserId();
        if (target) {
          const menu = await getOrCreateMenu(target.targetId);
          const config = menu.config || { categories: [], toppings: [] };
          let removed = false;

          (config.categories || []).forEach((cat: any) => {
            if (cat.dishes) {
              const initialLen = cat.dishes.length;
              cat.dishes = cat.dishes.filter((d: any) => !d.name.toLowerCase().includes(dishName.toLowerCase()));
              if (cat.dishes.length < initialLen) removed = true;
            }
          });

          if (removed) {
            await supabase.from('menutech_menus').upsert({
              user_id: target.targetId,
              domain: menu.domain || 'undetermined',
              slug: menu.slug || 'restaurant',
              menu_style: menu.menu_style || 'mode2',
              cover_url: menu.cover_url || '',
              cover_type: menu.cover_type || 'image',
              config: config
            }, { onConflict: 'user_id' });

            actionPerformed = true;
            actionReply = `¡Listo! He eliminado el platillo **"${dishName}"** del menú.`;
          } else {
            actionPerformed = true;
            actionReply = `No encontré el platillo "${dishName}" en el menú.`;
          }
        }
      }
    }

    if (actionPerformed) {
      return new Response(
        JSON.stringify({ reply: actionReply, menuUpdated: true, actionPerformed: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Build Gemini AI Chat payload
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
      systemInstruction: { parts: [{ text: systemInstructionCombined }] },
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800
      }
    };

    // 3. Sequential fallback across available Gemini models
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

    function cleanGeminiReply(text: string): string {
      if (!text) return "¡Hola! ¿En qué puedo ayudarte hoy con la plataforma Menutech?";

      let cleaned = text;

      // 1. Remove markdown code blocks if any
      cleaned = cleaned.replace(/```[\s\S]*?```/g, "");

      // 2. Remove checklist bullets
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

      cleaned = cleaned.trim();

      const doubleQuoteMatches = cleaned.match(/"([^"]+)"/g);
      if (doubleQuoteMatches && doubleQuoteMatches.length > 0) {
        const extracted = doubleQuoteMatches.map((m) => m.replace(/^"|"$/g, "").trim());
        cleaned = extracted[extracted.length - 1] || cleaned;
      } else {
        cleaned = cleaned.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();
      }

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
