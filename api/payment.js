// AllowPay API Integration
// Pagamento via PIX com AllowPay Gateway

const db = require("./_db");

const BASE_URL = process.env.ALLOWPAY_BASE_URL || "https://api.allowpay.online/functions/v1";
const UTMIFY_API_URL = "https://api.utmify.com.br/api-credentials/orders";

function formatUtcDate(date) {
  const iso = new Date(date).toISOString();
  return iso.replace("T", " ").substring(0, 19);
}

function buildTrackingParameters(tracking) {
  const utm = tracking && typeof tracking.utm === "object" && tracking.utm ? tracking.utm : {};
  return {
    src: tracking?.src || utm?.src || null,
    sck: tracking?.sck || utm?.sck || null,
    utm_source: utm?.utm_source || utm?.source || null,
    utm_campaign: utm?.utm_campaign || null,
    utm_medium: utm?.utm_medium || null,
    utm_content: utm?.utm_content || null,
    utm_term: utm?.utm_term || null,
  };
}

async function sendUtmifyOrder({
  token,
  orderId,
  status,
  createdAt,
  approvedDate,
  customer,
  products,
  trackingParameters,
  totalPriceInCents,
  gatewayFeeInCents = 0,
  userCommissionInCents,
  paymentMethod = "pix",
  platform = "AllowPay",
}) {
  if (!token) return;
  const payload = {
    orderId: String(orderId),
    platform,
    paymentMethod,
    status,
    createdAt: formatUtcDate(createdAt),
    approvedDate: approvedDate ? formatUtcDate(approvedDate) : null,
    refundedAt: null,
    customer,
    products,
    trackingParameters,
    commission: {
      totalPriceInCents,
      gatewayFeeInCents,
      userCommissionInCents,
    },
    isTest: false,
  };

  try {
    const resp = await fetch(UTMIFY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": token,
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("[UTMIFY] Erro ao enviar pedido:", resp.status, data);
    }
  } catch (error) {
    console.error("[UTMIFY] Falha ao enviar pedido:", error.message || error);
  }
}

let leadsTableReady = false;

async function ensureLeadsTable() {
  if (leadsTableReady) return;
  await db.query(
    "CREATE TABLE IF NOT EXISTS leads (" +
      "id SERIAL PRIMARY KEY, " +
      "created_at TIMESTAMPTZ DEFAULT NOW(), " +
      "source TEXT, " +
      "cpf TEXT, " +
      "nome TEXT, " +
      "email TEXT, " +
      "phone TEXT, " +
      "amount_cents INTEGER, " +
      "title TEXT, " +
      "transaction_id TEXT, " +
      "status TEXT, " +
      "tracking TEXT, " +
      "user_agent TEXT, " +
      "ip TEXT" +
    ")",
  );
  await db.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS status TEXT");
  leadsTableReady = true;
}

async function saveLead(data) {
  if (!db.getConnectionString()) return;
  try {
    await ensureLeadsTable();
    await db.query(
      "INSERT INTO leads (" +
        "source, cpf, nome, email, phone, amount_cents, title, transaction_id, status, tracking, user_agent, ip" +
      ") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        data.source || "",
        data.cpf || "",
        data.nome || "",
        data.email || "",
        data.phone || "",
        data.amount_cents || null,
        data.title || "",
        data.transaction_id || "",
        data.status || "",
        data.tracking || "",
        data.user_agent || "",
        data.ip || "",
      ],
    );
  } catch (error) {
    console.error("[PAYMENT] Falha ao salvar lead:", error.message);
  }
}

async function handlePaymentRequest(req, res) {
  // Handle OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const ALLOWPAY_USERNAME = process.env.ALLOWPAY_USERNAME || process.env.ALLOWPAY_SECRET_KEY;
    const ALLOWPAY_PASSWORD = process.env.ALLOWPAY_PASSWORD || process.env.ALLOWPAY_COMPANY_ID;
    const ALLOWPAY_POSTBACK_URL = process.env.ALLOWPAY_POSTBACK_URL;

    if (!ALLOWPAY_USERNAME || !ALLOWPAY_PASSWORD) {
      return res.status(500).json({
        success: false,
        message: "Credenciais da AllowPay não configuradas",
      });
    }

    if (!ALLOWPAY_POSTBACK_URL) {
      return res.status(500).json({
        success: false,
        message: "ALLOWPAY_POSTBACK_URL não configurada",
      });
    }

    // Parse body
    let bodyData = req.body;
    if (typeof bodyData === "string") {
      bodyData = JSON.parse(bodyData);
    }

    const { cpf, nome, email, phone, amount, title, description } = bodyData;
    const customerFromBody = bodyData.customer && typeof bodyData.customer === "object"
      ? bodyData.customer
      : null;

    console.log("[PAYMENT] Dados recebidos:", { cpf, nome, email, phone });

    // Validação
    const validCpf = (cpf ?? customerFromBody?.document?.number ?? customerFromBody?.taxId)?.toString().trim();
    const validNome = (nome ?? customerFromBody?.name)?.toString().trim();
    const validEmail = (email ?? customerFromBody?.email)?.toString().trim();
    const validPhone = (phone ?? customerFromBody?.phone ?? customerFromBody?.cellphone)?.toString().trim();

    if (!validNome || !validEmail) {
      return res.status(400).json({
        success: false,
        message: "Nome e Email são obrigatórios",
      });
    }

    const FIXED_AMOUNT = amount || process.env.FIXED_AMOUNT || "64.73";
    const FIXED_TITLE = description || title || "Taxa de Adesão";

    const normalizeAmountToCents = (value) => {
      if (value === undefined || value === null || value === "") {
        const parsed = Number(String(FIXED_AMOUNT).replace(",", "."));
        return Math.round(parsed * 100);
      }
      if (typeof value === "string" && (value.includes(",") || value.includes("."))) {
        const parsed = Number(value.replace(",", "."));
        return Math.round(parsed * 100);
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 0;
      if (!Number.isInteger(numeric)) {
        return Math.round(numeric * 100);
      }
      // Heurística: valores pequenos (<= 1000) tratamos como reais
      if (numeric <= 1000) return numeric * 100;
      return numeric;
    };

    const amountCents = normalizeAmountToCents(amount);

    if (!amountCents || amountCents < 100) {
      return res.status(400).json({
        success: false,
        message: "Amount inválido (mínimo 100 centavos)",
      });
    }

    const customer = {
      name: customerFromBody?.name || validNome,
      email: customerFromBody?.email || validEmail,
      phone: (customerFromBody?.phone || customerFromBody?.cellphone || validPhone || "").toString().replace(/\D/g, ""),
      taxId: (customerFromBody?.document?.number || customerFromBody?.taxId || validCpf || "").toString().replace(/\D/g, ""),
    };

    const trackingFromBody = bodyData.tracking;
    const tracking = (() => {
      if (trackingFromBody && typeof trackingFromBody === "object" && !Array.isArray(trackingFromBody)) {
        const utm = typeof trackingFromBody.utm === "object" && trackingFromBody.utm ? trackingFromBody.utm : {};
        const src = trackingFromBody.src || bodyData.src || req.headers.referer || "";
        return { utm, src };
      }
      if (typeof trackingFromBody === "string") {
        return { utm: {}, src: trackingFromBody };
      }
      const utm = typeof bodyData.utm === "object" && bodyData.utm ? bodyData.utm : {};
      const src = bodyData.src || req.headers.referer || "";
      return { utm, src };
    })();

    const documentType = customerFromBody?.document?.type
      || (customer.taxId && customer.taxId.length > 11 ? "CNPJ" : "CPF");

    const buildShippingAddress = () => {
      const shippingFromBody = bodyData.shipping && typeof bodyData.shipping === "object"
        ? bodyData.shipping
        : null;
      const addressFromBody = shippingFromBody?.address && typeof shippingFromBody.address === "object"
        ? shippingFromBody.address
        : null;

      let defaultShippingJson = null;
      if (process.env.ALLOWPAY_DEFAULT_SHIPPING_JSON) {
        try {
          defaultShippingJson = JSON.parse(process.env.ALLOWPAY_DEFAULT_SHIPPING_JSON);
        } catch (error) {
          console.error("[PAYMENT] ALLOWPAY_DEFAULT_SHIPPING_JSON invÃ¡lido:", error.message);
        }
      }

      const fallback = {
        street: defaultShippingJson?.address?.street || process.env.ALLOWPAY_DEFAULT_STREET || "",
        streetNumber: defaultShippingJson?.address?.streetNumber || process.env.ALLOWPAY_DEFAULT_STREET_NUMBER || "",
        complement: defaultShippingJson?.address?.complement || process.env.ALLOWPAY_DEFAULT_COMPLEMENT || "",
        zipCode: defaultShippingJson?.address?.zipCode || process.env.ALLOWPAY_DEFAULT_ZIP_CODE || "",
        neighborhood: defaultShippingJson?.address?.neighborhood || process.env.ALLOWPAY_DEFAULT_NEIGHBORHOOD || "",
        city: defaultShippingJson?.address?.city || process.env.ALLOWPAY_DEFAULT_CITY || "",
        state: defaultShippingJson?.address?.state || process.env.ALLOWPAY_DEFAULT_STATE || "",
        country: defaultShippingJson?.address?.country || process.env.ALLOWPAY_DEFAULT_COUNTRY || "BR",
      };

      const address = {
        street: addressFromBody?.street || fallback.street,
        streetNumber: addressFromBody?.streetNumber || fallback.streetNumber,
        complement: addressFromBody?.complement || fallback.complement,
        zipCode: addressFromBody?.zipCode || fallback.zipCode,
        neighborhood: addressFromBody?.neighborhood || fallback.neighborhood,
        city: addressFromBody?.city || fallback.city,
        state: addressFromBody?.state || fallback.state,
        country: addressFromBody?.country || fallback.country,
      };

      const required = [
        address.street,
        address.streetNumber,
        address.zipCode,
        address.neighborhood,
        address.city,
        address.state,
        address.country,
      ];

      if (required.some((value) => !value)) return null;
      return { address };
    };

    const shipping = buildShippingAddress();
    if (!shipping) {
      return res.status(400).json({
        success: false,
        message: "EndereÃ§o de envio obrigatÃ³rio (shipping.address)",
      });
    }

    const payload = {
      amount: amountCents,
      paymentMethod: "PIX",
      items: [
        {
          title: FIXED_TITLE,
          unitPrice: amountCents,
          quantity: 1,
        },
      ],
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        document: { type: documentType, number: customer.taxId },
      },
      shipping,
      pix: {
        expiresInDays: 1,
      },
      postbackUrl: ALLOWPAY_POSTBACK_URL,
      metadata: JSON.stringify({
        source: "popseal",
        cpf: customer.taxId,
        email: customer.email,
      }),
      ip: bodyData.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
      description: bodyData.description || FIXED_TITLE,
    };

    const userAgent = bodyData.user_agent || req.headers["user-agent"] || "";

    await saveLead({
      timestamp: new Date().toISOString(),
      source: "payment_request",
      cpf: validCpf || "",
      nome: validNome || "",
      email: validEmail || "",
      phone: validPhone || "",
      amount_cents: amountCents,
      title: FIXED_TITLE,
      tracking: JSON.stringify(tracking || {}),
      user_agent: userAgent,
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
    });

    console.log("[PAYMENT] Enviando para AllowPay...");

    const authToken = Buffer.from(`${ALLOWPAY_USERNAME}:${ALLOWPAY_PASSWORD}`).toString("base64");

    const resp = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Basic ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("[PAYMENT] Erro AllowPay:", resp.status, data);
      return res.status(502).json({
        success: false,
        message: data?.error || "Falha ao criar PIX",
        detalhes: data?.details || data?.detalhes,
      });
    }

    const txData = data || {};
    const tx = txData?.id;
    const pixText = txData?.pix?.qrcode || "";
    const pixQrWithPrefix = txData?.pix?.qrcode || "";

    if (!tx || !pixText) {
      return res.status(502).json({
        success: false,
        message: "Gateway não retornou dados esperados",
      });
    }

    await saveLead({
      timestamp: new Date().toISOString(),
      source: "payment_response",
      cpf: validCpf || "",
      nome: validNome || "",
      email: validEmail || "",
      phone: validPhone || "",
      amount_cents: txData?.amount || amountCents,
      title: FIXED_TITLE,
      transaction_id: String(tx),
      status: String(txData?.status || "waiting_payment"),
    });

    const UTMIFY_API_TOKEN = process.env.UTMIFY_API_TOKEN;
    const customerForUtmify = {
      name: customer.name,
      email: customer.email,
      phone: customer.phone || null,
      document: customer.taxId || null,
      country: "BR",
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null,
    };
    const productsForUtmify = [
      {
        id: "taxa_adesao",
        name: FIXED_TITLE,
        planId: null,
        planName: null,
        quantity: 1,
        priceInCents: amountCents,
      },
    ];
    const trackingParameters = buildTrackingParameters(tracking || {});

    await sendUtmifyOrder({
      token: UTMIFY_API_TOKEN,
      orderId: String(tx),
      status: "waiting_payment",
      createdAt: new Date(),
      approvedDate: null,
      customer: customerForUtmify,
      products: productsForUtmify,
      trackingParameters,
      totalPriceInCents: amountCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: amountCents,
      paymentMethod: "pix",
      platform: "AllowPay",
    });

    return res.status(200).json({
      success: true,
      transaction_id: String(tx),
      pix_code: String(pixText),
      amount: txData?.amount || amountCents,
      status: String(txData?.status || "PENDING"),
      qr_code: pixQrWithPrefix,
      pix_qr_code: pixQrWithPrefix,
    });

  } catch (error) {
    console.error("[PAYMENT] Erro:", error.message);
    return res.status(500).json({
      success: false,
      message: "Erro interno",
      error: error.message,
    });
  }
}

module.exports = handlePaymentRequest;





