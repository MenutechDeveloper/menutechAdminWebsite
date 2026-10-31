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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

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
  userSession?: any;
}

// Obtener contexto de facturación y mensualidades de Supabase para alimentar el asistente
async function getBillingContext(userPrompt: string): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || "https://eemqyrysdgasfjlitads.supabase.co";
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || "";

    if (!supabaseUrl || !supabaseKey) return '';

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Consultar información de clientes, paquetes, mensualidades y pagos
    const [profilesRes, packagesRes, subsRes, paymentsRes] = await Promise.all([
      supabase.from('profiles').select('id, username, email, domain, role, is_suspended, created_at'),
      supabase.from('menutech_packages').select('id, name, price, billing_period, is_active'),
      supabase.from('menutech_subscriptions').select('id, user_id, package_id, service_start_date, last_payment_date, next_due_date, status, notes, updated_at'),
      supabase.from('menutech_subscription_payments').select('id, subscription_id, user_id, amount, payment_date, payment_method, reference, notes').order('payment_date', { ascending: false }).limit(50)
    ]);

    const profiles = profilesRes.data || [];
    const packages = packagesRes.data || [];
    const subscriptions = subsRes.data || [];
    const payments = paymentsRes.data || [];

    if (profiles.length === 0 && subscriptions.length === 0) return '';

    const now = new Date();
    const todayStr = now.toISOString().substring(0, 10);

    const clientSummaries = profiles.map((p: any) => {
      const sub = subscriptions.find((s: any) => s.user_id === p.id);
      const pkg = packages.find((pkgItem: any) => pkgItem.id === sub?.package_id);
      const userPayments = payments.filter((pay: any) => pay.user_id === p.id);

      // Calcular próximo vencimiento si no está fijado: registro + 1 mes
      let dueDateStr = sub?.next_due_date ? sub.next_due_date.substring(0, 10) : '';
      if (!dueDateStr && p.created_at) {
        const d = new Date(p.created_at);
        d.setMonth(d.getMonth() + 1);
        dueDateStr = d.toISOString().substring(0, 10);
      }

      let calcStatus = sub?.status || 'active';
      if (p.is_suspended) {
        calcStatus = 'suspended';
      } else if (dueDateStr) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(dueDateStr);
        due.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) calcStatus = 'overdue';
        else if (diffDays <= 5) calcStatus = 'due_soon';
        else calcStatus = 'active';
      }

      const statusDesc = calcStatus === 'suspended' ? 'SUSPENDIDO (servicio desactivado)'
        : calcStatus === 'overdue' ? 'VENCIDA (pago pendiente/atrasado)'
        : calcStatus === 'due_soon' ? 'PRÓXIMO A VENCER (vence en 5 días o menos)'
        : 'AL CORRIENTE (al día/pagado)';

      const lastPay = sub?.last_payment_date ? sub.last_payment_date.substring(0, 10) : (userPayments[0]?.payment_date ? userPayments[0].payment_date.substring(0, 10) : 'Ninguno registrado');

      return `• Cliente: ${p.username || 'Sin nombre'} | Dominio: ${p.domain || 'N/A'} | Email: ${p.email || 'N/A'}
  - Estado Servicio: ${p.is_suspended ? 'Suspendido' : 'Activo'}
  - Paquete: ${pkg ? `${pkg.name} ($${pkg.price}/mes)` : 'Sin paquete asignado'}
  - Estado Mensualidad: ${statusDesc}
  - Último Pago: ${lastPay}
  - Próximo Vencimiento: ${dueDateStr || 'No definido'}
  - Notas: ${sub?.notes || 'Sin notas'}
  - Historial de Pagos Recientes: ${userPayments.length > 0 ? userPayments.slice(0, 3).map((pay: any) => `$${pay.amount} el ${pay.payment_date?.substring(0, 10)} (${pay.payment_method || 'manual'}, ref: ${pay.reference || 's/r'})`).join('; ') : 'Sin pagos previos'}`;
    });

    const pkgsSummary = packages.map((pkg: any) => `${pkg.name} ($${pkg.price}/mes - ${pkg.is_active ? 'Activo' : 'Inactivo'})`).join(', ');

    return `
--- INFORMACIÓN DE FACTURACIÓN Y MENSUALIDADES EN TIEMPO REAL (BASE DE DATOS SUPABASE - adminBilling) ---
Fecha actual de consulta: ${todayStr}
Paquetes configurados: ${pkgsSummary || 'Ninguno'}

Resumen detallado de cuentas, mensualidades y pagos:
${clientSummaries.join('\n\n')}
----------------------------------------------------------------------------------------------------------
`;
  } catch (err) {
    console.warn("Error consultando información de facturación en Supabase:", err);
    return '';
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
      is_proactive = false
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

    if (currentParts.length > 0) {
      if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
        contents[contents.length - 1].parts.push(...currentParts);
      } else {
        contents.push({ role: 'user', parts: currentParts });
      }
    }

    // Obtener contexto de facturación en Supabase si aplica o para consultas administrativas
    let billingContext = '';
    try {
      billingContext = await getBillingContext(userPrompt);
    } catch (e) {
      console.warn("No se pudo cargar contexto de facturación:", e);
    }

    const systemInstruction = {
      parts: [
        {
          text: `Eres una Inteligencia Artificial extraordinariamente inteligente, capaz, brillante, empática, alegre y atenta (al estilo de ChatGPT / Gemini).
Tienes conocimientos amplios y profundos sobre programación, matemáticas, física, tecnología, cocina, ciencias, historia, filosofía, arte, cine, música, desarrollo web, pasatiempos y conversación general.
Tienes acceso total a la información de la base de datos de administración y facturación (adminBilling: paquetes, cuentas, estado de mensualidad, si un usuario ya pagó o no, si su mes está por vencerse, adeudos, suspensiones y registros de pago). Si te preguntan sobre pagos, cuentas, estados de clientes o vencimientos, consulta los datos provistos a continuación y responde con exactitud, claridad y precisión.

${billingContext ? `${billingContext}\n` : ''}REGLAS ABSOLUTAS E IMPERATIVAS:
1. Hablas SIEMPRE Y ÚNICAMENTE en español de forma natural, fluida, cercana, clara y directa.
2. Queda STRICTAMENTE PROHIBIDO incluir pensamientos internos, notas de razonamiento, traducciones al inglés, borradores de pasos, desgloses de preguntas o metacomentarios.
3. Si te hacen preguntas matemáticas o de cálculo (por ejemplo "1 más 1"), responde el resultado directo ("El resultado de 1 + 1 es 2").
4. Si te piden explicaciones, guías o recetas, entrega la información completa paso a paso con todos sus detalles directamente en español sin prefijos ni borradores.
5. NUNCA respondas con plantillas ni mensajes evasivos como "Con mucho gusto te ayudo, ¿qué aspecto quieres profundizar?". RESPONDE DE UNA VEZ LA CONSULTA COMPLETA.
6. Si te adjuntan una imagen, analízala con alta precisión y describe o responde detalladamente la consulta relacionada.
7. Al responder sobre pagos y mensualidades, indica directamente el nombre del cliente/restaurante, su dominio, si su mensualidad está al corriente, si está próxima a vencerse o vencida, la fecha de vencimiento y cuándo fue su último pago según los datos de la base de datos.`
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
