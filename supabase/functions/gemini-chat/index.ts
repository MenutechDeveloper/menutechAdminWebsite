// Supabase Edge Function: gemini-chat
// Handles AI Chatbot requests using Google Gemini API (Function Calling / Tools) & Supabase Database Operations.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// --- TYPES & INTERFACES ---
export interface UserSessionContext {
  id?: string;
  role?: string;
  username?: string;
  domain?: string;
  email?: string;
}

export interface DishVisibility {
  days: number[];
  start: string;
  end: string;
  startDate: string;
  endDate: string;
}

export interface DishSize {
  name: string;
  price: number;
}

export interface DishItem {
  name: string;
  description?: string;
  price: number;
  image?: string;
  sizes?: DishSize[];
  toppings?: string[];
}

export interface MenuCategory {
  name: string;
  description?: string;
  image?: string;
  visibility?: DishVisibility;
  dishes: DishItem[];
}

export interface ToppingItem {
  name: string;
  price: number;
}

export interface ToppingGroup {
  id: string;
  name: string;
  type: 'optional' | 'mandatory';
  min: number;
  max: number;
  items: ToppingItem[];
}

export interface MenuConfig {
  categories: MenuCategory[];
  toppings: ToppingGroup[];
}

export interface MenuRecord {
  id?: string;
  user_id: string;
  domain: string;
  slug: string;
  menu_style: string;
  cover_url: string;
  cover_type: string;
  config: MenuConfig;
  created_at?: string;
  updated_at?: string;
}

export interface ToolExecutionResult {
  success: boolean;
  message: string;
  targetUserId?: string;
  actionPerformed?: string;
}

export interface ChatHistoryItem {
  role: 'user' | 'model' | 'assistant';
  text?: string;
  content?: string;
}

export interface OrderAlertEvent {
  id: string;
  customerName: string;
  totalAmount?: number;
  status: string;
  createdAt?: string;
}

export interface PrinterAlertEvent {
  ip: string;
  name?: string;
  status: 'connected' | 'disconnected';
}

export interface RequestPayload {
  prompt?: string;
  message?: string;
  history?: ChatHistoryItem[];
  image?: { mimeType: string; data: string } | null;
  userSession?: UserSessionContext | null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_INSTRUCTION_BASE = `Eres la Inteligencia Artificial oficial de Menutech (Menutech Bot) encargada de responder dudas sobre la plataforma, servicios y soporte de restaurantes, además de administrar y editar en tiempo real los menús digitales de los clientes en la base de datos de Supabase.

REGLAS ABSOLUTAS E INVIOLABLES:
1. RESPONDE SIEMPRE Y ÚNICAMENTE EN ESPAÑOL, DE FORMA CONCISA, DIRECTA, AMABLE Y PROFESIONAL.
2. ESTÁ ESTRICTAMENTE PROHIBIDO MOSTRAR PENSAMIENTOS INTERNOS, LISTAS DE VERIFICACIÓN, PASOS DE RAZONAMIENTO O NOTAS EN INGLÉS.
3. NO INCLUYAS COMILLAS DOBLES NI COMILLAS SIMPLES ALREDEDOR DE TU RESPUESTA FINAL.
4. UTILIZA LAS HERRAMIENTAS / FUNCIONES DISPONIBLES (search_account, create_category, add_dish, update_price, delete_dish) SIEMPRE QUE EL USUARIO PIDA REALIZAR CAMBIOS, CONSULTAR O EDITAR EL MENÚ.
5. PUEDES EJECUTAR MÚLTIPLES HERRAMIENTAS SI EL USUARIO PIDE MÁS DE UNA ACCIÓN A LA VEZ (por ejemplo, crear una categoría y luego agregar varios platillos a ella).
6. REGLA DE SEGURIDAD DE ELIMINACIÓN: ESTÁ ESTRICTAMENTE PROHIBIDO ELIMINAR TODO EL MENÚ O BORRAR TODAS LAS CATEGORÍAS DE GOLPE. Si el usuario te pide borrado masivo, debes negarte educadamente.
7. CONTROL DE ACCESO SEGÚN EL ROL DEL USUARIO:
   - Si el usuario es 'OWNER': Solo puede modificar su propia cuenta. Si intenta editar la cuenta de otro cliente, debes indicarle que no tiene permisos.
   - Si el usuario es 'ADMIN', 'DEVELOPER', 'CS', 'ADMINCS', etc.: Tiene permisos globales para buscar cualquier restaurante y editar su menú.
8. NOTIFICACIONES EN TIEMPO REAL Y ALERTAS DE VOZ:
   - Notificación de nuevas órdenes y recordatorios dinámicos en inglés nativo de EE. UU.
   - Confirmación de impresoras térmicas conectadas y detectadas con éxito en la red local.`;

const TOOLS_DECLARATIONS = [
  {
    functionDeclarations: [
      {
        name: "search_account",
        description: "Busca y selecciona la cuenta de un restaurante/cliente por su nombre o dominio.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_name: { type: "STRING", description: "Nombre, usuario o dominio de la cuenta del cliente" }
          },
          required: ["account_name"]
        }
      },
      {
        name: "create_category",
        description: "Crea una nueva categoría en el menú del restaurante indicado o seleccionado.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_name: { type: "STRING", description: "Nombre de la cuenta del cliente (opcional si ya está seleccionada)" },
            category_name: { type: "STRING", description: "Nombre de la nueva categoría a crear" }
          },
          required: ["category_name"]
        }
      },
      {
        name: "add_dish",
        description: "Agrega un platillo al menú del restaurante. Se puede especificar categoría, precio y descripción.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_name: { type: "STRING", description: "Nombre de la cuenta del cliente (opcional si ya está seleccionada)" },
            category_name: { type: "STRING", description: "Nombre de la categoría donde agregar el platillo" },
            dish_name: { type: "STRING", description: "Nombre del platillo" },
            price: { type: "NUMBER", description: "Precio numérico del platillo" },
            description: { type: "STRING", description: "Descripción del platillo" }
          },
          required: ["dish_name"]
        }
      },
      {
        name: "update_price",
        description: "Actualiza el precio de un platillo existente en el menú.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_name: { type: "STRING", description: "Nombre de la cuenta del cliente" },
            dish_name: { type: "STRING", description: "Nombre del platillo a actualizar" },
            new_price: { type: "NUMBER", description: "Nuevo precio en número" }
          },
          required: ["dish_name", "new_price"]
        }
      },
      {
        name: "delete_dish",
        description: "Elimina un platillo individual del menú.",
        parameters: {
          type: "OBJECT",
          properties: {
            account_name: { type: "STRING", description: "Nombre de la cuenta del cliente" },
            dish_name: { type: "STRING", description: "Nombre del platillo a eliminar" }
          },
          required: ["dish_name"]
        }
      }
    ]
  }
];

serve(async (req: Request) => {
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

    const payloadBody: RequestPayload = await req.json().catch(() => ({}));
    const { prompt, message, history = [], image, userSession = null } = payloadBody;
    const userMessage = (prompt || message || "").trim();

    if (!userMessage && !image) {
      return new Response(
        JSON.stringify({ reply: "Por favor escribe un mensaje o envía una imagen." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Identify user role and session parameters from DB
    let userId: string | null = userSession?.id || null;
    let userRole = (userSession?.role || 'owner').trim().toLowerCase();
    let username = userSession?.username || '';
    let userDomain = userSession?.domain || '';

    if (userId) {
      const { data: dbProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (dbProfile) {
        if (dbProfile.role) userRole = dbProfile.role.trim().toLowerCase();
        if (dbProfile.username) username = dbProfile.username;
        if (dbProfile.domain) userDomain = dbProfile.domain;
      }
    }

    const nonOwnerRoles = ['admin', 'developer', 'cs', 'admincs', 'admindesign', 'design', 'retention'];
    const isOwner = !nonOwnerRoles.includes(userRole) && userRole !== 'admin';

    // Mass deletion safety guard
    const lowerUserMsg = userMessage.toLowerCase();
    if (lowerUserMsg.includes("elimina todo") || lowerUserMsg.includes("borra todo") || lowerUserMsg.includes("vaciar menu") || lowerUserMsg.includes("borrar todo")) {
      return new Response(
        JSON.stringify({ reply: "Por seguridad, no tengo permitido eliminar todo el menú de golpe. Puedo ayudarte a eliminar platillos o categorías individuales uno por uno si me indicas cuáles deseas borrar." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Role safety guard for OWNER trying to edit another account
    if (isOwner && (lowerUserMsg.includes("cuenta de") || lowerUserMsg.includes("ve a la cuenta") || lowerUserMsg.includes("entra a la cuenta"))) {
      const currentUsername = (username || userSession?.username || '').toLowerCase();
      if (currentUsername && !lowerUserMsg.includes(currentUsername)) {
        return new Response(
          JSON.stringify({ reply: "Como usuario propietario de tu cuenta, solo tienes permisos para modificar el menú de tu propia cuenta. No es posible acceder o editar los menús de otros clientes." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Persistent Target Account Resolver across chat history
    let lastMentionedAccount = "";
    if (Array.isArray(history)) {
      for (let i = history.length - 1; i >= 0; i--) {
        const hText = (history[i].text || history[i].content || "");
        const matchAcc = hText.match(/(?:cuenta de|restaurante|cliente|en)\s+\*?\*?([a-zA-Z0-9\s-]+)\*?\*?/i);
        if (matchAcc && matchAcc[1] && matchAcc[1].trim().length > 2) {
          const candidate = matchAcc[1].trim();
          if (!candidate.toLowerCase().includes("que") && !candidate.toLowerCase().includes("esta")) {
            lastMentionedAccount = candidate;
            break;
          }
        }
      }
    }

    async function resolveTargetAccount(accountNameQuery?: string): Promise<{ targetId: string; accountName: string; domain: string } | null> {
      if (isOwner) {
        if (!userId) return null;
        return { targetId: userId, accountName: username || 'tu cuenta', domain: userDomain || 'undetermined' };
      }

      const searchTerm = (accountNameQuery || lastMentionedAccount || "").toLowerCase().trim();

      if (searchTerm) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, domain, email');

        if (profiles && profiles.length > 0) {
          const cleanSearch = searchTerm.replace(/^(la|el|los|las)\s+/i, "").trim();
          const match = profiles.find((p: any) => {
            const u = (p.username || '').toLowerCase();
            const d = (p.domain || '').toLowerCase();
            const e = (p.email || '').toLowerCase();
            return u.includes(cleanSearch) || cleanSearch.includes(u) ||
                   d.includes(cleanSearch) || cleanSearch.includes(d) ||
                   e.includes(cleanSearch);
          });

          if (match) {
            return { targetId: match.id, accountName: match.username || match.domain || match.email, domain: match.domain || '' };
          }
        }
      }

      if (userId) {
        return { targetId: userId, accountName: username || 'tu cuenta', domain: userDomain || 'undetermined' };
      }
      return null;
    }

    async function getOrCreateMenu(targetId: string, defaultDomain: string = ''): Promise<MenuRecord> {
      const { data: existingMenu } = await supabase
        .from('menutech_menus')
        .select('*')
        .eq('user_id', targetId)
        .maybeSingle();

      if (existingMenu) return existingMenu as MenuRecord;

      const { data: prof } = await supabase.from('profiles').select('domain, username').eq('id', targetId).maybeSingle();
      const domain = prof?.domain || defaultDomain || 'undetermined';
      const slug = (prof?.domain || prof?.username || 'restaurant').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      const newMenu: MenuRecord = {
        user_id: targetId,
        domain: domain,
        slug: slug,
        menu_style: 'mode2',
        cover_url: '',
        cover_type: 'image',
        config: { categories: [], toppings: [] }
      };

      const { data: inserted } = await supabase.from('menutech_menus').insert(newMenu).select().single();
      return (inserted || newMenu) as MenuRecord;
    }

    // CRUD Executor for Gemini Function Calls
    async function executeFunctionCall(name: string, args: Record<string, any>): Promise<ToolExecutionResult> {
      console.log(`Executing tool function: ${name}`, args);

      if (name === "search_account") {
        const resolved = await resolveTargetAccount(args.account_name);
        if (resolved) {
          const menu = await getOrCreateMenu(resolved.targetId, resolved.domain);
          const catCount = menu.config?.categories?.length || 0;
          return {
            success: true,
            targetUserId: resolved.targetId,
            actionPerformed: 'search_account',
            message: `He seleccionado la cuenta de **${resolved.accountName}**. Tiene ${catCount} categoría(s) en su menú activo.`
          };
        } else {
          return {
            success: false,
            message: `No se encontró ninguna cuenta que coincida con "${args.account_name}".`
          };
        }
      }

      if (name === "create_category") {
        const resolved = await resolveTargetAccount(args.account_name);
        if (!resolved) return { success: false, message: "No se especificó o encontró la cuenta a editar." };

        const menu = await getOrCreateMenu(resolved.targetId, resolved.domain);
        const config: MenuConfig = menu.config || { categories: [], toppings: [] };
        if (!config.categories) config.categories = [];

        const catName = (args.category_name || '').trim();
        if (!catName) return { success: false, message: "Nombre de categoría inválido." };

        const exists = config.categories.some((c: MenuCategory) => c.name.toLowerCase() === catName.toLowerCase());
        if (!exists) {
          config.categories.push({
            name: catName,
            description: '',
            image: '',
            visibility: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', startDate: '', endDate: '' },
            dishes: []
          });

          const { error } = await supabase.from('menutech_menus').upsert({
            user_id: resolved.targetId,
            domain: menu.domain || 'undetermined',
            slug: menu.slug || 'restaurant',
            menu_style: menu.menu_style || 'mode2',
            cover_url: menu.cover_url || '',
            cover_type: menu.cover_type || 'image',
            config: config
          }, { onConflict: 'user_id' });

          if (error) {
            console.error("Error updating DB in create_category:", error);
            return { success: false, message: `Error en base de datos: ${error.message}` };
          }

          return {
            success: true,
            targetUserId: resolved.targetId,
            actionPerformed: 'create_category',
            message: `Categoría **"${catName}"** creada con éxito en la cuenta de ${resolved.accountName}.`
          };
        } else {
          return {
            success: true,
            targetUserId: resolved.targetId,
            actionPerformed: 'create_category',
            message: `La categoría **"${catName}"** ya existe en la cuenta de ${resolved.accountName}.`
          };
        }
      }

      if (name === "add_dish") {
        const resolved = await resolveTargetAccount(args.account_name);
        if (!resolved) return { success: false, message: "No se especificó la cuenta a editar." };

        const menu = await getOrCreateMenu(resolved.targetId, resolved.domain);
        const config: MenuConfig = menu.config || { categories: [], toppings: [] };
        if (!config.categories) config.categories = [];

        const dishName = (args.dish_name || '').trim();
        const price = typeof args.price === 'number' ? args.price : parseFloat(args.price || 0) || 0;
        const description = args.description || '';
        const targetCatName = (args.category_name || '').trim();

        if (!dishName) return { success: false, message: "Nombre de platillo inválido." };

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
          ? config.categories.find((c: MenuCategory) => c.name.toLowerCase() === targetCatName.toLowerCase())
          : config.categories[config.categories.length - 1];

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
          description: description,
          price: price,
          image: '',
          sizes: [],
          toppings: []
        });

        const { error } = await supabase.from('menutech_menus').upsert({
          user_id: resolved.targetId,
          domain: menu.domain || 'undetermined',
          slug: menu.slug || 'restaurant',
          menu_style: menu.menu_style || 'mode2',
          cover_url: menu.cover_url || '',
          cover_type: menu.cover_type || 'image',
          config: config
        }, { onConflict: 'user_id' });

        if (error) {
          console.error("Error updating DB in add_dish:", error);
          return { success: false, message: `Error en base de datos: ${error.message}` };
        }

        return {
          success: true,
          targetUserId: resolved.targetId,
          actionPerformed: 'add_dish',
          message: `Platillo **"${dishName}"** ($${price}) agregado a la categoría **"${catObj.name}"** en ${resolved.accountName}.`
        };
      }

      if (name === "update_price") {
        const resolved = await resolveTargetAccount(args.account_name);
        if (!resolved) return { success: false, message: "Cuenta no encontrada." };

        const menu = await getOrCreateMenu(resolved.targetId, resolved.domain);
        const config: MenuConfig = menu.config || { categories: [], toppings: [] };
        const dishName = (args.dish_name || '').trim();
        const newPrice = typeof args.new_price === 'number' ? args.new_price : parseFloat(args.new_price || 0) || 0;

        let updated = false;
        (config.categories || []).forEach((cat: MenuCategory) => {
          (cat.dishes || []).forEach((dish: DishItem) => {
            if (dish.name.toLowerCase().includes(dishName.toLowerCase()) || dishName.toLowerCase().includes(dish.name.toLowerCase())) {
              dish.price = newPrice;
              updated = true;
            }
          });
        });

        if (updated) {
          const { error } = await supabase.from('menutech_menus').upsert({
            user_id: resolved.targetId,
            domain: menu.domain || 'undetermined',
            slug: menu.slug || 'restaurant',
            menu_style: menu.menu_style || 'mode2',
            cover_url: menu.cover_url || '',
            cover_type: menu.cover_type || 'image',
            config: config
          }, { onConflict: 'user_id' });

          if (error) {
            console.error("Error updating DB in update_price:", error);
            return { success: false, message: `Error en base de datos: ${error.message}` };
          }

          return {
            success: true,
            targetUserId: resolved.targetId,
            actionPerformed: 'update_price',
            message: `Precio de **"${dishName}"** actualizado a **$${newPrice}** en ${resolved.accountName}.`
          };
        } else {
          return {
            success: false,
            message: `Platillo "${dishName}" no encontrado en el menú.`
          };
        }
      }

      if (name === "delete_dish") {
        const resolved = await resolveTargetAccount(args.account_name);
        if (!resolved) return { success: false, message: "Cuenta no encontrada." };

        const menu = await getOrCreateMenu(resolved.targetId, resolved.domain);
        const config: MenuConfig = menu.config || { categories: [], toppings: [] };
        const dishName = (args.dish_name || '').trim();

        let removed = false;
        (config.categories || []).forEach((cat: MenuCategory) => {
          if (cat.dishes) {
            const initialLen = cat.dishes.length;
            cat.dishes = cat.dishes.filter((d: DishItem) => !d.name.toLowerCase().includes(dishName.toLowerCase()));
            if (cat.dishes.length < initialLen) removed = true;
          }
        });

        if (removed) {
          const { error } = await supabase.from('menutech_menus').upsert({
            user_id: resolved.targetId,
            domain: menu.domain || 'undetermined',
            slug: menu.slug || 'restaurant',
            menu_style: menu.menu_style || 'mode2',
            cover_url: menu.cover_url || '',
            cover_type: menu.cover_type || 'image',
            config: config
          }, { onConflict: 'user_id' });

          if (error) {
            console.error("Error updating DB in delete_dish:", error);
            return { success: false, message: `Error en base de datos: ${error.message}` };
          }

          return {
            success: true,
            targetUserId: resolved.targetId,
            actionPerformed: 'delete_dish',
            message: `Platillo **"${dishName}"** eliminado del menú de ${resolved.accountName}.`
          };
        } else {
          return {
            success: false,
            message: `Platillo "${dishName}" no encontrado en el menú.`
          };
        }
      }

      return { success: false, message: "Función desconocida." };
    }

    // Fetch Learned Knowledge Base Context & Active Automations Rules
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

      const { data: automationsList } = await supabase
        .from('menutech_automations')
        .select('name, config, gemini_enabled')
        .eq('status', 'active');

      if (automationsList && automationsList.length > 0) {
        learnedKnowledgeText += "\n\nREGLAS DE AUTOMATIZACIONES Y ALGORITMOS ACTIVOS:\n" +
          automationsList.map((a: any) => `-[AUTOMATIZACIÓN: ${a.name}]: ${JSON.stringify(a.config)}`).join("\n");
      }
    } catch (e) {
      console.warn("Error fetching learned knowledge or automations:", e);
    }

    // 1. Discover available Gemini models
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

    // 2. Build Gemini API Payload with Tools / Functions
    const sessionInfoText = `\nDATOS DEL USUARIO ACTUAL EN SESIÓN:\n- ID: ${userId || 'No identificado'}\n- Rol: ${userRole.toUpperCase()}\n- Nombre: ${username || userSession?.username || 'Usuario'}\n- Dominio: ${userDomain || 'Sin dominio'}`;
    const systemInstructionCombined = SYSTEM_INSTRUCTION_BASE + sessionInfoText + learnedKnowledgeText;

    const contents: any[] = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        contents.push({
          role: msg.role === "assistant" || msg.role === "model" ? "model" : "user",
          parts: [{ text: msg.text || msg.content || "" }]
        });
      }
    }

    const currentParts: any[] = [];
    if (userMessage) currentParts.push({ text: userMessage });
    if (image && image.data) {
      const mimeType = image.mimeType || "image/png";
      const cleanBase64 = image.data.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
      currentParts.push({ inlineData: { mimeType, data: cleanBase64 } });
    }

    contents.push({ role: "user", parts: currentParts });

    const payload = {
      systemInstruction: { parts: [{ text: systemInstructionCombined }] },
      contents: contents,
      tools: TOOLS_DECLARATIONS,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 800
      }
    };

    // 3. Call Gemini Model
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
          aiData = data;
          break;
        }
      } catch (e) {
        console.warn(`Error on model ${modelName}:`, e);
      }
    }

    if (!aiData) {
      return new Response(
        JSON.stringify({ reply: "Error al comunicarse con la IA de Google Gemini." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const candidate = aiData.candidates?.[0];
    const candidateParts = candidate?.content?.parts || [];

    // Check for Tool Function Calls returned by Gemini
    let executedResults: string[] = [];
    let menuUpdated = false;
    let targetUserIdUpdated: string | null = null;
    let actionPerformed: string | null = null;

    for (const part of candidateParts) {
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        const result = await executeFunctionCall(name, args || {});
        if (result.success) {
          menuUpdated = true;
          if (result.actionPerformed) actionPerformed = result.actionPerformed;
        }
        if (result.targetUserId) targetUserIdUpdated = result.targetUserId;
        executedResults.push(result.message);
      }
    }

    // Fallback manual intent parsing if Gemini generated pure text instead of functionCall for explicit commands
    if (executedResults.length === 0) {
      const lower = userMessage.toLowerCase();
      // Search account command
      if (!isOwner && (lower.includes("cuenta de") || lower.includes("buscar cuenta") || lower.includes("ve a la cuenta"))) {
        const targetSearch = userMessage.replace(/.*(cuenta de|buscar cuenta|ve a la cuenta)\s*/i, "").split(/[\n,]/)[0].trim();
        if (targetSearch) {
          const res = await executeFunctionCall("search_account", { account_name: targetSearch });
          if (res.message) executedResults.push(res.message);
          if (res.targetUserId) targetUserIdUpdated = res.targetUserId;
          actionPerformed = 'search_account';
          menuUpdated = true;
        }
      }

      // Add Category command
      if (lower.includes("categoria") || lower.includes("categoría")) {
        const catMatch = userMessage.match(/(?:crea|agrega|nueva)\s+la\s+categor[ií]a\s+["']?([^"'\n\.$]+)["']?/i);
        if (catMatch && catMatch[1]) {
          const res = await executeFunctionCall("create_category", { category_name: catMatch[1].trim() });
          if (res.message) executedResults.push(res.message);
          if (res.targetUserId) targetUserIdUpdated = res.targetUserId;
          actionPerformed = 'create_category';
          menuUpdated = true;
        }
      }

      // Add Dish command
      if (lower.includes("platillo") || lower.includes("platillos")) {
        const dishMatches = userMessage.match(/(?:agrega|crea|nuevo)\s+(?:el\s+)?platillo\s+["']?([^"'\n\.$]+)["']?/gi);
        if (dishMatches) {
          for (const matchStr of dishMatches) {
            const nameClean = matchStr.replace(/.*platillo\s*/i, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
            const priceMatch = userMessage.match(/\$?\s*(\d+(\.\d+)?)/);
            const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
            if (nameClean) {
              const res = await executeFunctionCall("add_dish", { dish_name: nameClean, price: price });
              if (res.message) executedResults.push(res.message);
              if (res.targetUserId) targetUserIdUpdated = res.targetUserId;
              actionPerformed = 'add_dish';
              menuUpdated = true;
            }
          }
        }
      }
    }

    let finalReply = "";
    if (executedResults.length > 0) {
      finalReply = executedResults.join(" ");
    } else {
      finalReply = candidateParts.map((p: any) => p.text || "").join("").trim();
    }

    function cleanGeminiReply(text: string): string {
      if (!text) return "¡Hola! ¿En qué puedo ayudarte hoy con la plataforma Menutech?";

      let cleaned = text;
      cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
      cleaned = cleaned.replace(/^\s*\*.*?\?.*$/gm, "");
      cleaned = cleaned.replace(/^\s*\*.*?\b(Yes|No|Si|No)\b.*$/gm, "");

      const lines = cleaned.split("\n").map(l => l.trim()).filter(l => {
        if (!l) return false;
        if (l.startsWith("*") && (l.includes("?") || l.includes("Yes") || l.includes("No"))) return false;
        if (l.toLowerCase().includes("the user said") || l.toLowerCase().includes("plan:")) return false;
        return true;
      });

      if (lines.length > 0) cleaned = lines.join(" ");

      cleaned = cleaned.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();
      return cleaned || "¡Listo! He realizado los cambios en el menú.";
    }

    finalReply = cleanGeminiReply(finalReply);

    return new Response(
      JSON.stringify({
        reply: finalReply,
        menuUpdated: menuUpdated,
        targetUserId: targetUserIdUpdated,
        actionPerformed: actionPerformed
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ reply: "Error interno: " + err.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
