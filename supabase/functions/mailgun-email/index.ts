// Supabase Edge Function: mailgun-email
// Sends order and reservation notification emails via Mailgun API when items reach 'Ready' status.
// Required Supabase Secret: mailgunApi

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const { type, item, restaurant, domain: customDomain } = payload;

    if (!type || !item) {
      return new Response(
        JSON.stringify({ error: "Faltan parámetros requeridos ('type' y 'item')." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mailgunApiKey = (
      Deno.env.get("mailgunApi") ||
      Deno.env.get("MAILGUN_API_KEY") ||
      ""
    ).trim();

    if (!mailgunApiKey) {
      return new Response(
        JSON.stringify({ error: "Secret 'mailgunApi' no encontrada en Supabase. Configura el secret 'mailgunApi' en tu proyecto." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mailgunDomain = (
      customDomain ||
      Deno.env.get("MAILGUN_DOMAIN") ||
      Deno.env.get("mailgunDomain") ||
      "mg.menutech.io"
    ).trim();

    const recipientEmail = item.customer_email || item.email;
    if (!recipientEmail) {
      return new Response(
        JSON.stringify({ error: "El cliente no cuenta con una dirección de correo válida." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract restaurant brand information
    const restName = restaurant?.name || restaurant?.restaurant_name || "Menutech";
    const restLogo = restaurant?.logo_url || "https://menutech.services/assets/img/logomt.png";
    const brandColor = restaurant?.brand_color || "#ff9533";
    const restPhone = restaurant?.phone || "";
    const restAddress = restaurant?.address || "";

    let subject = "";
    let htmlContent = "";

    if (type === "order") {
      subject = `¡Tu pedido está listo! - ${restName}`;
      htmlContent = renderOrderEmailTemplate({
        item,
        restName,
        restLogo,
        brandColor,
        restPhone,
        restAddress
      });
    } else if (type === "reservation") {
      subject = `¡Tu reservación está lista! - ${restName}`;
      htmlContent = renderReservationEmailTemplate({
        item,
        restName,
        restLogo,
        brandColor,
        restPhone,
        restAddress
      });
    } else {
      return new Response(
        JSON.stringify({ error: `Tipo de correo no válido: '${type}'` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send email via Mailgun REST API v3
    const formData = new URLSearchParams();
    formData.append("from", `${restName} <no-reply@${mailgunDomain}>`);
    formData.append("to", recipientEmail);
    formData.append("subject", subject);
    formData.append("html", htmlContent);

    const mailgunUrl = `https://api.mailgun.net/v3/${mailgunDomain}/messages`;
    const authHeader = `Basic ${btoa(`api:${mailgunApiKey}`)}`;

    console.log(`Sending Mailgun email to ${recipientEmail} via domain ${mailgunDomain}`);

    const mgRes = await fetch(mailgunUrl, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString()
    });

    const mgData = await mgRes.json().catch(() => ({}));

    if (!mgRes.ok) {
      console.error("Mailgun API error response:", mgData);
      return new Response(
        JSON.stringify({
          error: mgData.message || `Mailgun retornó código HTTP ${mgRes.status}`,
          details: mgData
        }),
        { status: mgRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Correo enviado exitosamente", data: mgData }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Internal Edge Function Error:", err);
    return new Response(
      JSON.stringify({ error: "Error interno en Edge Function: " + err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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
  const total = parseFloat(item.total || item.total_amount || 0).toFixed(2);
  const deliveryType = item.order_type === "delivery" ? "Entrega a Domicilio / Delivery" : "Recoger en Local / Pickup";
  const paymentMethod = (item.payment_method || "Efectivo").toUpperCase();

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
                Hola <strong style="color: #1a202c;">${item.customer_name || "Cliente"}</strong>,
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
                    <strong>Teléfono:</strong> ${item.customer_phone || "N/A"}<br>
                    <strong>Método de pago:</strong> ${paymentMethod}<br>
                    ${item.address ? `<strong>Dirección:</strong> ${item.address}<br>` : ""}
                    ${item.reference ? `<strong>Referencia:</strong> ${item.reference}<br>` : ""}
                    ${item.customer_notes ? `<strong>Instrucciones:</strong> <em>"${item.customer_notes}"</em><br>` : ""}
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
                  <tr style="background-color: #f8fafc;">
                    <td style="padding: 14px 16px; font-size: 16px; font-weight: 800; color: #1a202c;">Total</td>
                    <td style="padding: 14px 16px; font-size: 18px; font-weight: 800; color: ${brandColor}; text-align: right;">$${total}</td>
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
  const preorderItems = Array.isArray(item.preorder_items) ? item.preorder_items : [];
  const partySize = item.party_size || item.guests_count || 2;
  const resDate = item.reservation_date || "Hoy";
  const resTime = item.reservation_time || "Por llegar";

  const preorderRowsHtml = preorderItems.map((it: any) => {
    const qty = it.quantity || 1;
    const price = (parseFloat(it.price || 0) * qty).toFixed(2);
    return `
      <tr>
        <td style="padding: 10px 14px; border-bottom: 1px solid #334155; font-size: 13px; color: #e2e8f0;">
          <strong>${qty}x ${it.name}</strong>
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
                Estimado/a <strong style="color: #f59e0b;">${item.customer_name || "Comensal"}</strong>,
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
                          📞 Teléfono: <strong style="color: #f8fafc;">${item.customer_phone || "N/A"}</strong>
                        </td>
                      </tr>
                    </table>
                    ${item.comments ? `
                      <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #1e293b; font-size: 13px; color: #cbd5e1;">
                        <strong>Solicitudes Especiales:</strong> <em>"${item.comments}"</em>
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
