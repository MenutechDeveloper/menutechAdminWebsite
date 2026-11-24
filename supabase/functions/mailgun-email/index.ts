// Supabase Edge Function: mailgun-email
// Sends "order ready" / "table ready" emails to customers through the Mailgun API.
//
// Secrets (Project Settings -> Edge Functions -> Secrets):
//   mailgunApi       (required) Mailgun Private API key ("key-..." or the newer key)
//   MAILGUN_DOMAIN   (optional) sending domain, defaults to mg.menutech.io
//   MAILGUN_REGION   (optional) "us" (default) or "eu"
//   MAILGUN_API_BASE (optional) full override, e.g. https://api.eu.mailgun.net
//   MAILGUN_FROM     (optional) full From header, e.g. "Menutech <no-reply@mg.menutech.io>"
//
// A key from an EU-region domain only works against api.eu.mailgun.net, so the
// function retries the other region on 401/403/404 instead of failing outright.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_DOMAIN = "mg.menutech.io";
const DEFAULT_BRAND_COLOR = "#ff9533";
const DEFAULT_LOGO = "https://menutech.services/assets/img/logomt.png";
const REGION_BASES: Record<string, string> = {
  us: "https://api.mailgun.net",
  eu: "https://api.eu.mailgun.net",
};
const RETRYABLE_STATUS = new Set([401, 403, 404]);

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function readSecret(...names: string[]): string {
  for (const name of names) {
    const raw = Deno.env.get(name);
    if (!raw) continue;
    const value = raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    if (value) return value;
  }
  return "";
}

function basicAuthHeader(key: string): string | null {
  try {
    return `Basic ${btoa(`api:${key}`)}`;
  } catch {
    return null;
  }
}

function regionOf(base: string): string {
  return /eu\.mailgun\.net/i.test(base) ? "eu" : "us";
}

function isUuid(value: unknown): boolean {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function sanitizeDeep(value: unknown): unknown {
  if (typeof value === "string") return escapeHtml(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeDeep(val);
    }
    return out;
  }
  return value;
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function safeColor(value: unknown): string {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : DEFAULT_BRAND_COLOR;
}

function safeUrl(value: unknown, fallback = ""): string {
  const url = String(value ?? "").trim();
  if (!url) return fallback;
  if (!/^(https?:\/\/|data:image\/)/i.test(url)) return fallback;
  return url.replace(/["'<>]/g, "");
}

function sanitizeDomain(value: unknown): string {
  const domain = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : DEFAULT_DOMAIN;
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

async function dbSelect(table: string, query: string): Promise<any[] | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`DB select ${table} failed: ${res.status} ${await res.text().catch(() => "")}`);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data) ? data : data ? [data] : [];
  } catch (err) {
    console.warn(`DB select ${table} error:`, err);
    return null;
  }
}

async function dbPatch(table: string, id: string, values: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !isUuid(id)) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      console.warn(`DB patch ${table} failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    console.warn(`DB patch ${table} error:`, err);
  }
}

type Branding = { name: string; logo: string; color: string; phone: string; address: string };

function rowTime(row: any): number {
  const ts = row?.updated_at;
  return ts ? Date.parse(ts) || 0 : 0;
}

// Mirrors the merge logic in restaurantInfo.html: web templates and menus win
// over menutech_restaurants only when they were updated more recently.
async function resolveBranding(userId: string, fallback: any): Promise<Branding> {
  const brand: Branding = {
    name: String(fallback?.name || fallback?.restaurant_name || "").trim() || "Menutech",
    logo: safeUrl(fallback?.logo_url || fallback?.logo, ""),
    color: safeColor(fallback?.brand_color || fallback?.primaryColor),
    phone: String(fallback?.phone || "").trim(),
    address: String(fallback?.address || "").trim(),
  };

  if (!isUuid(userId)) {
    brand.logo = brand.logo || DEFAULT_LOGO;
    return brand;
  }

  const [restRows, webRows, menuRows, footerRows, ticketRows] = await Promise.all([
    dbSelect("menutech_restaurants", `select=*&user_id=eq.${userId}&limit=1`),
    dbSelect("menutech_web_templates", `select=*&user_id=eq.${userId}&limit=1`),
    dbSelect("menutech_menus", `select=*&user_id=eq.${userId}&limit=1`),
    dbSelect("menutech_footers", `select=*&user_id=eq.${userId}&limit=1`),
    dbSelect("menutech_tickets", `select=*&user_id=eq.${userId}&limit=1`),
  ]);

  const rest = restRows?.[0];
  const web = webRows?.[0];
  const menu = menuRows?.[0];
  const webCfg = web?.config || {};
  const menuCfg = menu?.config || {};
  const footerCfg = footerRows?.[0]?.config || {};
  const ticketCfg = ticketRows?.[0]?.config || {};

  const restTime = rowTime(rest);
  const webTime = rowTime(web);
  const menuTime = rowTime(menu);

  if (rest?.name) brand.name = String(rest.name).trim();
  if (webCfg.title && webTime > restTime) brand.name = String(webCfg.title).trim();
  if (menuCfg.restaurant_name && menuTime > restTime && menuTime >= webTime) {
    brand.name = String(menuCfg.restaurant_name).trim();
  }

  let logo = "";
  if (rest?.logo_url) logo = safeUrl(rest.logo_url, "");
  if (webCfg.logoImg && webTime > restTime) logo = safeUrl(webCfg.logoImg, logo);
  if (!logo) logo = safeUrl(footerCfg.logo, "") || safeUrl(ticketCfg.logo_url, "");
  brand.logo = logo || DEFAULT_LOGO;

  if (rest?.phone) brand.phone = String(rest.phone).trim();
  if (rest?.address) brand.address = String(rest.address).trim();
  if (webTime > restTime) {
    if (webCfg.contact?.phone) brand.phone = String(webCfg.contact.phone).trim();
    if (webCfg.contact?.address) brand.address = String(webCfg.contact.address).trim();
  }

  brand.color = safeColor(
    footerCfg.primaryColor || webCfg.primaryColor || rest?.brand_color || brand.color,
  );
  return brand;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));

    const mailgunKey = readSecret("mailgunApi", "MAILGUN_API_KEY", "MAILGUN_KEY");
    if (!mailgunKey) {
      return jsonResponse({
        error: "No se encontró el secret 'mailgunApi'. Configúralo en Project Settings → Edge Functions → Secrets.",
      }, 500);
    }

    const authHeader = basicAuthHeader(mailgunKey);
    if (!authHeader) {
      return jsonResponse({ error: "El secret 'mailgunApi' contiene caracteres inválidos." }, 500);
    }

    const regionPref = readSecret("MAILGUN_REGION", "mailgunRegion").toLowerCase();
    const customBase = readSecret("MAILGUN_API_BASE", "mailgunApiBase").replace(/\/+$/, "");
    const bases = customBase
      ? [customBase]
      : regionPref === "eu"
      ? [REGION_BASES.eu, REGION_BASES.us]
      : [REGION_BASES.us, REGION_BASES.eu];

    if (payload.action === "verify" || payload.action === "diagnose") {
      const results: Array<Record<string, unknown>> = [];
      for (const base of [REGION_BASES.us, REGION_BASES.eu]) {
        try {
          const res = await fetch(`${base}/v3/domains?limit=100`, {
            headers: { Authorization: authHeader },
          });
          const text = await res.text();
          let data: any = null;
          try {
            data = JSON.parse(text);
          } catch {
            // Mailgun returns plain text for some auth failures.
          }
          results.push({
            region: regionOf(base),
            status: res.status,
            ok: res.ok,
            domains: Array.isArray(data?.items) ? data.items.map((d: any) => d.name) : undefined,
            message: res.ok ? undefined : (data?.message || text.slice(0, 200)),
          });
        } catch (err) {
          results.push({ region: regionOf(base), status: 0, ok: false, message: String(err) });
        }
      }
      const ok = results.some((r) => r.ok);
      return jsonResponse({ ok, results }, ok ? 200 : 502);
    }

    const type = String(payload.type || "").trim();
    if (type !== "order" && type !== "reservation") {
      return jsonResponse({ error: "Parámetro 'type' inválido. Usa 'order' o 'reservation'." }, 400);
    }

    const domain = sanitizeDomain(
      payload.domain || readSecret("MAILGUN_DOMAIN", "mailgunDomain") || DEFAULT_DOMAIN,
    );

    const table = type === "order" ? "menutech_orders" : "menutech_reservations";
    const incomingItem = payload.item && typeof payload.item === "object" ? payload.item : {};
    const itemId = String(payload.item_id || incomingItem.id || "").trim();

    const dbRow = isUuid(itemId)
      ? (await dbSelect(table, `select=*&id=eq.${itemId}&limit=1`))?.[0] ?? null
      : null;

    if (!dbRow && Object.keys(incomingItem).length === 0) {
      return jsonResponse({ error: "Faltan parámetros: envía 'item' o un 'item_id' válido." }, 400);
    }

    if (dbRow?.email_notified_at && !payload.force) {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: "already_notified",
        notified_at: dbRow.email_notified_at,
      });
    }

    // DB values win over the client payload, but never wipe it with nulls.
    const merged: Record<string, any> = { ...incomingItem };
    for (const [key, value] of Object.entries(dbRow || {})) {
      if (value !== null && value !== undefined && value !== "") merged[key] = value;
    }
    merged.items = asArray(merged.items);
    merged.preorder_items = asArray(merged.preorder_items);

    const recipientEmail = String(
      merged.customer_email || merged.email || merged.customerEmail || "",
    ).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return jsonResponse({ error: "El cliente no cuenta con una dirección de correo válida." }, 400);
    }

    const ownerId = String(payload.owner_id || merged.user_id || incomingItem.user_id || "").trim();
    const brand = await resolveBranding(ownerId, payload.restaurant);

    const safeItem = sanitizeDeep(merged) as Record<string, any>;
    const restName = escapeHtml(brand.name);
    const restPhone = escapeHtml(brand.phone);
    const restAddress = escapeHtml(brand.address);
    const restLogo = safeUrl(brand.logo, "");

    const subject = sanitizeHeader(
      type === "order"
        ? `¡Tu pedido está listo! - ${brand.name}`
        : `¡Tu reservación está lista! - ${brand.name}`,
    );

    const htmlContent = type === "order"
      ? renderOrderEmailTemplate({
        item: safeItem,
        restName,
        restLogo,
        brandColor: brand.color,
        restPhone,
        restAddress,
      })
      : renderReservationEmailTemplate({
        item: safeItem,
        restName,
        restLogo,
        brandColor: brand.color,
        restPhone,
        restAddress,
      });

    const fromOverride = sanitizeHeader(readSecret("MAILGUN_FROM", "mailgunFrom"));
    const fromName = brand.name.replace(/[<>"\r\n]/g, " ").replace(/\s+/g, " ").trim() || "Menutech";
    const from = fromOverride || `${fromName} <no-reply@${domain}>`;

    const formData = new URLSearchParams();
    formData.append("from", from);
    formData.append("to", recipientEmail);
    formData.append("subject", subject);
    formData.append("html", htmlContent);
    formData.append("h:X-Mailgun-Variables", JSON.stringify({ type, item_id: itemId || null }));

    const attempts: Array<{ region: string; status: number; message: string }> = [];
    let lastData: any = null;
    let sent = false;

    for (const base of bases) {
      let res: Response;
      try {
        res = await fetch(`${base}/v3/${domain}/messages`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        });
      } catch (err) {
        attempts.push({ region: regionOf(base), status: 0, message: String(err) });
        break;
      }

      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Mailgun returns plain text for some errors.
      }
      const message = String(parsed?.message || text || `HTTP ${res.status}`).slice(0, 400);
      attempts.push({ region: regionOf(base), status: res.status, message });

      if (res.ok) {
        sent = true;
        lastData = parsed ?? text;
        break;
      }

      lastData = parsed ?? { message };
      if (!RETRYABLE_STATUS.has(res.status)) break;
    }

    if (!sent) {
      const last = attempts[attempts.length - 1] || { region: "us", status: 0, message: "sin respuesta" };
      console.error("Mailgun send failed:", attempts);
      const hint = last.status === 401
        ? "Mailgun rechazó la API key. Usa la Private API key del mismo dominio (Settings → API keys) y, si tu dominio está en la región EU, configura el secret MAILGUN_REGION=eu."
        : last.status === 404
        ? `El dominio '${domain}' no existe en tu cuenta de Mailgun. Configura el secret MAILGUN_DOMAIN.`
        : undefined;
      return jsonResponse({
        error: `Mailgun ${last.status} (${last.region}): ${last.message}`,
        hint,
        attempts,
        domain,
        recipient: recipientEmail,
      }, 502);
    }

    if (isUuid(itemId)) {
      await dbPatch(table, itemId, { email_notified_at: new Date().toISOString() });
    }

    return jsonResponse({
      success: true,
      message: "Correo enviado exitosamente",
      recipient: recipientEmail,
      domain,
      region: attempts[attempts.length - 1]?.region,
      data: lastData,
    });
  } catch (err: any) {
    console.error("Internal Edge Function Error:", err);
    return jsonResponse({ error: "Error interno en Edge Function: " + err.message }, 500);
  }
});

/**
 * Modern Responsive HTML Template for Order Ready Email
 */
function renderOrderEmailTemplate(data: {
  item: any;
  restName: string;
  restLogo: string;
  brandColor: string;
  restPhone: string;
  restAddress: string;
}): string {
  const { item, restName, restLogo, brandColor, restPhone, restAddress } = data;
  const items = Array.isArray(item.items) ? item.items : [];
  const total = parseFloat(item.total || item.total_amount || item.totalAmount || 0).toFixed(2);
  const deliveryFee = parseFloat(item.delivery_fee || item.deliveryFee || 0);
  const subtotal = item.subtotal !== undefined && item.subtotal !== null
    ? parseFloat(item.subtotal).toFixed(2)
    : (deliveryFee > 0 ? (parseFloat(total) - deliveryFee).toFixed(2) : total);
  // `item` is the DB row after sanitizeDeep(), so its strings are already HTML-escaped.
  const zoneName = item.delivery_zone_name || item.deliveryZoneName;
  const orderType = item.order_type || item.orderType;
  const deliveryType = orderType === "delivery"
    ? (zoneName ? `Entrega a Domicilio (${zoneName})` : "Entrega a Domicilio / Delivery")
    : "Recoger en Local / Pickup";
  const paymentMethod = (item.payment_method || item.paymentMethod || "Efectivo").toUpperCase();
  const customerName = item.customer_name || item.customerName || "Cliente";
  const customerPhone = item.customer_phone || item.customerPhone || "N/A";
  const customerEmail = item.customer_email || item.customerEmail || "";
  const customerNotes = item.customer_notes || item.customerNotes;
  const address = item.address || "";
  const reference = item.reference || "";
  const schedule = item.delivery_time_mode === "later"
    ? [item.delivery_date, item.delivery_time].filter(Boolean).join(" · ")
    : "";
  const shortId = String(item.id || "").slice(0, 8).toUpperCase();

  const itemsRowsHtml = items.map((it: any) => {
    const qty = it.quantity || 1;
    const price = (parseFloat(it.price || 0) * qty).toFixed(2);
    const meta = [
      it.size ? `Tamaño: ${it.size}` : "",
      it.toppings && it.toppings.length > 0 ? `Toppings: ${it.toppings.join(", ")}` : "",
      it.instructions ? `Nota: "${it.instructions}"` : ""
    ].filter(Boolean).join(" • ");

    return `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; font-size: 14px; color: #2d3748;">
          <strong style="color: #1a202c;">${qty}x ${it.name || "Producto"}</strong>
          ${meta ? `<div style="font-size: 12px; color: #718096; margin-top: 4px;">${meta}</div>` : ""}
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7; font-size: 14px; font-weight: bold; color: ${brandColor}; text-align: right;">
          $${price}
        </td>
      </tr>
    `;
  }).join("");

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Tu pedido está listo!</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6f9; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f4f6f9; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width:600px; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.08);">

          <!-- Header Banner -->
          <tr>
            <td style="background-color: ${brandColor}; padding: 32px 24px; text-align: center;">
              ${restLogo ? `<img src="${restLogo}" alt="${restName}" style="max-height: 70px; max-width: 180px; margin-bottom: 12px; border-radius: 8px; background: #ffffff; padding: 6px; display: inline-block;">` : ""}
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">
                ${restName}
              </h1>
            </td>
          </tr>

          <!-- Ready Badge Banner -->
          <tr>
            <td style="background-color: #10b981; padding: 16px 24px; text-align: center;">
              <span style="color: #ffffff; font-size: 16px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;">
                🎉 ¡TU PEDIDO ESTÁ LISTO!
              </span>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 32px 28px;">
              <p style="font-size: 16px; color: #2d3748; margin-top: 0; margin-bottom: 20px; line-height: 1.6;">
                Hola <strong style="color: #1a202c;">${customerName}</strong>,
              </p>
              <p style="font-size: 15px; color: #4a5568; margin-bottom: 24px; line-height: 1.6;">
                ¡Buenas noticias! Tu pedido ha sido preparado con dedicación y ya se encuentra <strong style="color: #10b981;">listo para recoger o entregar</strong>.
              </p>

              <!-- Order Info Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #e2e8f0;">
                <tr>
                  <td style="font-size: 13px; color: #718096; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px; padding-bottom: 10px;">
                    DETALLES DE ENTREGA
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 14px; color: #2d3748; line-height: 1.8;">
                    <strong>Modalidad:</strong> ${deliveryType}<br>
                    ${shortId ? `<strong>Pedido:</strong> #${shortId}<br>` : ""}
                    ${schedule ? `<strong>Programado:</strong> ${schedule}<br>` : ""}
                    <strong>Teléfono:</strong> ${customerPhone}<br>
                    ${customerEmail ? `<strong>Correo:</strong> ${customerEmail}<br>` : ""}
                    <strong>Método de pago:</strong> ${paymentMethod}<br>
                    ${address ? `<strong>Dirección:</strong> ${address}<br>` : ""}
                    ${reference ? `<strong>Referencia:</strong> ${reference}<br>` : ""}
                    ${customerNotes ? `<strong>Instrucciones:</strong> <em>"${customerNotes}"</em><br>` : ""}
                  </td>
                </tr>
              </table>

              <!-- Order Items Table -->
              <h3 style="font-size: 15px; color: #1a202c; margin-bottom: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
                Resumen del Pedido
              </h3>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin-bottom: 24px; border: 1px solid #edf2f7; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f7fafc;">
                    <th align="left" style="padding: 10px 16px; font-size: 12px; color: #718096; text-transform: uppercase; border-bottom: 1px solid #edf2f7;">Producto</th>
                    <th align="right" style="padding: 10px 16px; font-size: 12px; color: #718096; text-transform: uppercase; border-bottom: 1px solid #edf2f7;">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsRowsHtml || `<tr><td colspan="2" style="padding:12px; font-size:14px; color:#718096;">Detalles del pedido procesados</td></tr>`}
                </tbody>
                <tfoot>
                  ${deliveryFee > 0 ? `
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 10px 16px; font-size: 14px; color: #718096; border-top: 1px solid #edf2f7;">Subtotal productos</td>
                      <td style="padding: 10px 16px; font-size: 14px; color: #2d3748; text-align: right; border-top: 1px solid #edf2f7;">$${subtotal}</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                      <td style="padding: 10px 16px; font-size: 14px; color: #718096;">Costo de envío ${zoneName ? `(${zoneName})` : ''}</td>
                      <td style="padding: 10px 16px; font-size: 14px; color: #2d3748; text-align: right;">$${deliveryFee.toFixed(2)}</td>
                    </tr>
                  ` : ''}
                  <tr style="background-color: #f8fafc;">
                    <td style="padding: 14px 16px; font-size: 16px; font-weight: 800; color: #1a202c; border-top: 1.5px solid #edf2f7;">Total</td>
                    <td style="padding: 14px 16px; font-size: 18px; font-weight: 800; color: ${brandColor}; text-align: right; border-top: 1.5px solid #edf2f7;">$${total}</td>
                  </tr>
                </tfoot>
              </table>

              <!-- Action Callout Box -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px;">
                <tr>
                  <td>
                    <p style="margin: 0; font-size: 15px; font-weight: bold; color: #065f46;">
                      📍 ¡Te esperamos en ${restName}!
                    </p>
                    ${restAddress ? `<p style="margin: 6px 0 0 0; font-size: 13px; color: #047857;">${restAddress}</p>` : ""}
                    ${restPhone ? `<p style="margin: 4px 0 0 0; font-size: 13px; color: #047857;">Teléfono / WhatsApp: ${restPhone}</p>` : ""}
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #1e293b; padding: 24px; text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.5;">
              <p style="margin: 0 0 8px 0; font-weight: bold; color: #f8fafc; font-size: 13px;">${restName}</p>
              ${restAddress ? `<p style="margin: 0 0 4px 0;">${restAddress}</p>` : ""}
              ${restPhone ? `<p style="margin: 0 0 12px 0;">Contacto: ${restPhone}</p>` : ""}
              <p style="margin: 0; opacity: 0.6;">Potenciado por Menutech Platform</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Elegant Responsive HTML Template for Reservation Ready Email
 */
function renderReservationEmailTemplate(data: {
  item: any;
  restName: string;
  restLogo: string;
  brandColor: string;
  restPhone: string;
  restAddress: string;
}): string {
  const { item, restName, restLogo, brandColor, restPhone, restAddress } = data;
  const preorderItems = Array.isArray(item.preorder_items)
    ? item.preorder_items
    : (Array.isArray(item.preorderItems) ? item.preorderItems : []);
  // `item` is the DB row after sanitizeDeep(), so its strings are already HTML-escaped.
  const partySize = item.party_size || item.partySize || item.guests_count || 2;
  const resDate = item.reservation_date || item.reservationDate || "Hoy";
  const resTime = item.reservation_time || item.reservationTime || "Por llegar";
  const customerName = item.customer_name || item.customerName || "Comensal";
  const customerPhone = item.customer_phone || item.customerPhone || "N/A";
  const customerEmail = item.customer_email || item.customerEmail || "";
  const comments = item.comments || "";
  const shortId = String(item.id || "").slice(0, 8).toUpperCase();
  const preorderTotal = preorderItems.reduce(
    (sum: number, it: any) => sum + parseFloat(it.price || 0) * (it.quantity || 1),
    0,
  );

  const preorderRowsHtml = preorderItems.map((it: any) => {
    const qty = it.quantity || 1;
    const price = (parseFloat(it.price || 0) * qty).toFixed(2);
    return `
      <tr>
        <td style="padding: 10px 14px; border-bottom: 1px solid #334155; font-size: 13px; color: #e2e8f0;">
          <strong>${qty}x ${it.name || "Producto"}</strong>
          ${it.instructions ? `<div style="font-size: 11px; color: #94a3b8;">"${it.instructions}"</div>` : ""}
        </td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #334155; font-size: 13px; font-weight: bold; color: #f59e0b; text-align: right;">
          $${price}
        </td>
      </tr>
    `;
  }).join("");

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Tu Mesa está Lista!</title>
</head>
<body style="margin:0; padding:0; background-color:#0f172a; font-family:'Outfit', 'Georgia', serif, sans-serif; -webkit-font-smoothing:antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#0f172a; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width:600px; background-color:#1e293b; border-radius:20px; overflow:hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.5); border: 1px solid #334155;">

          <!-- Elegant Top Accent Bar -->
          <tr>
            <td style="background: linear-gradient(90deg, #bf953f 0%, #fcf6ba 25%, #b38728 50%, #fbf5b7 75%, #aa771c 100%); height: 5px;"></td>
          </tr>

          <!-- Header Banner -->
          <tr>
            <td style="padding: 36px 28px 20px 28px; text-align: center; background-color: #1e293b;">
              ${restLogo ? `<img src="${restLogo}" alt="${restName}" style="max-height: 80px; max-width: 200px; margin-bottom: 16px; border-radius: 10px; background: #0f172a; padding: 8px; border: 1px solid #334155; display: inline-block;">` : ""}
              <h1 style="color: #f8fafc; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 2px; font-family: 'Georgia', serif;">
                ${restName}
              </h1>
              <p style="color: #94a3b8; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; margin-top: 6px;">
                Reservación Confirmada
              </p>
            </td>
          </tr>

          <!-- Table Ready Badge Banner -->
          <tr>
            <td style="background-color: #8b5cf6; padding: 18px 24px; text-align: center;">
              <span style="color: #ffffff; font-size: 16px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;">
                ✨ ¡TU MESA Y LUGAR ESTÁN LISTOS!
              </span>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 36px 32px; background-color: #1e293b;">
              <p style="font-size: 17px; color: #f8fafc; margin-top: 0; margin-bottom: 18px; line-height: 1.6;">
                Estimado/a <strong style="color: #f59e0b;">${customerName}</strong>,
              </p>
              <p style="font-size: 15px; color: #cbd5e1; margin-bottom: 28px; line-height: 1.7;">
                Nos complace informarte que tu mesa está preparada y lista para recibirte en <strong style="color: #ffffff;">${restName}</strong>. Nuestro equipo te espera para brindarte una experiencia inolvidable.
              </p>

              <!-- Reservation Details Box -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0f172a; border-radius: 16px; padding: 24px; margin-bottom: 28px; border: 1px solid #334155;">
                <tr>
                  <td style="font-size: 11px; color: #8b5cf6; text-transform: uppercase; font-weight: 800; letter-spacing: 1.5px; padding-bottom: 14px; border-bottom: 1px solid #1e293b;">
                    INFORMACIÓN DE LA RESERVACIÓN
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 14px;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50%" style="padding: 6px 0; font-size: 14px; color: #94a3b8;">
                          📅 Fecha: <strong style="color: #f8fafc;">${resDate}</strong>
                        </td>
                        <td width="50%" style="padding: 6px 0; font-size: 14px; color: #94a3b8;">
                          ⏰ Hora: <strong style="color: #f8fafc;">${resTime}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 6px 0; font-size: 14px; color: #94a3b8;">
                          👥 Personas: <strong style="color: #8b5cf6;">${partySize} invitados</strong>
                        </td>
                        <td width="50%" style="padding: 6px 0; font-size: 14px; color: #94a3b8;">
                          📞 Teléfono: <strong style="color: #f8fafc;">${customerPhone}</strong>
                        </td>
                      </tr>
                      ${customerEmail ? `
                        <tr>
                          <td colspan="2" style="padding: 6px 0; font-size: 14px; color: #94a3b8;">
                            ✉️ Correo: <strong style="color: #f8fafc;">${customerEmail}</strong>
                          </td>
                        </tr>
                      ` : ""}
                      ${shortId ? `
                        <tr>
                          <td colspan="2" style="padding: 6px 0; font-size: 14px; color: #94a3b8;">
                            🔖 Reservación: <strong style="color: #f8fafc;">#${shortId}</strong>
                          </td>
                        </tr>
                      ` : ""}
                    </table>
                    ${comments ? `
                      <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #1e293b; font-size: 13px; color: #cbd5e1;">
                        <strong>Solicitudes Especiales:</strong> <em>"${comments}"</em>
                      </div>
                    ` : ""}
                  </td>
                </tr>
              </table>

              <!-- Pre-ordered items (if any) -->
              ${preorderItems.length > 0 ? `
                <h3 style="font-size: 14px; color: #f59e0b; margin-bottom: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
                  Platillos Pre-ordenados
                </h3>
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin-bottom: 28px; background-color: #0f172a; border-radius: 12px; overflow: hidden; border: 1px solid #334155;">
                  <tbody>
                    ${preorderRowsHtml}
                  </tbody>
                  ${preorderTotal > 0 ? `
                    <tfoot>
                      <tr>
                        <td style="padding: 12px 14px; font-size: 13px; color: #94a3b8; font-weight: 700; border-top: 1px solid #334155;">Total pre-orden</td>
                        <td style="padding: 12px 14px; font-size: 15px; color: #f59e0b; font-weight: 800; text-align: right; border-top: 1px solid #334155;">$${preorderTotal.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  ` : ""}
                </table>
              ` : ""}

              <!-- Elegant Notice / Welcome Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(245,158,11,0.15) 100%); border: 1px solid #8b5cf6; border-radius: 16px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <tr>
                  <td>
                    <p style="margin: 0; font-size: 15px; font-weight: bold; color: #f8fafc;">
                      📍 ${restName}
                    </p>
                    ${restAddress ? `<p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1;">${restAddress}</p>` : ""}
                    ${restPhone ? `<p style="margin: 4px 0 0 0; font-size: 13px; color: #f59e0b;">Teléfono / Reservaciones: ${restPhone}</p>` : ""}
                    <p style="margin: 10px 0 0 0; font-size: 12px; color: #94a3b8; font-style: italic;">
                      Te sugerimos llegar con 5 minutos de anticipación.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px; text-align: center; color: #64748b; font-size: 12px; border-top: 1px solid #1e293b; line-height: 1.5;">
              <p style="margin: 0 0 6px 0; font-weight: bold; color: #cbd5e1; font-size: 13px;">${restName}</p>
              ${restAddress ? `<p style="margin: 0 0 4px 0;">${restAddress}</p>` : ""}
              ${restPhone ? `<p style="margin: 0 0 12px 0;">Contacto: ${restPhone}</p>` : ""}
              <p style="margin: 0; opacity: 0.5;">Potenciado por Menutech Platform</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}
