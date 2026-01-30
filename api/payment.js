// AllowPay API Integration v1.0
// Pagamento via PIX com AllowPay Gateway

const db = require("./_db");

const BASE_URL = process.env.ALLOWPAY_BASE_URL || "https://api.allowpay.online/functions/v1";

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
    const ALLOWPAY_USERNAME = process.env.ALLOWPAY_USERNAME;
    const ALLOWPAY_PASSWORD = process.env.ALLOWPAY_PASSWORD;
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
    const validCpf = (cpf ?? customerFromBody?.taxId)?.toString().trim();
    const validNome = (nome ?? customerFromBody?.name)?.toString().trim();
    const validEmail = (email ?? customerFromBody?.email)?.toString().trim();
    const validPhone = (phone ?? customerFromBody?.cellphone)?.toString().trim();

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
      cellphone: (customerFromBody?.cellphone || validPhone || "").toString().replace(/\D/g, ""),
      taxId: (customerFromBody?.taxId || validCpf || "").toString().replace(/\D/g, ""),
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

    const normalizeShipping = (value) => {
      if (!value) return null;
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      if (typeof value === "object" && !Array.isArray(value)) return value;
      return null;
    };

    const shippingFromBody = normalizeShipping(bodyData.shipping || bodyData.address);
    let shipping = shippingFromBody;
    if (!shipping) {
      const defaultShipping = normalizeShipping(process.env.ALLOWPAY_DEFAULT_SHIPPING_JSON);
      if (defaultShipping) shipping = defaultShipping;
    }

    if (!shipping) {
      return res.status(400).json({
        success: false,
        message: "Shipping é obrigatório para AllowPay. Envie body.shipping ou configure ALLOWPAY_DEFAULT_SHIPPING_JSON.",
      });
    }

    const requiredShippingFields = ["street", "streetNumber", "neighborhood", "zipCode", "city", "state"];
    const missingShipping = requiredShippingFields.filter((field) => !shipping?.[field]);
    if (missingShipping.length) {
      return res.status(400).json({
        success: false,
        message: `Shipping incompleto. Campos obrigatórios: ${missingShipping.join(", ")}`,
      });
    }

    const payload = {
      amount: amountCents,
      paymentMethod: "PIX",
      postbackUrl: ALLOWPAY_POSTBACK_URL,
      metadata: JSON.stringify({
        source: "popseal",
        cpf: customer.taxId,
        email: customer.email,
        tracking,
      }),
      description: FIXED_TITLE,
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.cellphone,
        document: customer.taxId,
      },
      shipping: {
        street: shipping.street,
        streetNumber: shipping.streetNumber,
        neighborhood: shipping.neighborhood,
        zipCode: shipping.zipCode,
        city: shipping.city,
        state: shipping.state,
        complement: shipping.complement || "",
      },
      items: [
        {
          title: FIXED_TITLE,
          unitPrice: amountCents,
          quantity: 1,
          externalRef: "taxa_adesao",
        },
      ],
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

    const authHeader = Buffer.from(`${ALLOWPAY_USERNAME}:${ALLOWPAY_PASSWORD}`).toString("base64");
    const resp = await fetch(`${BASE_URL}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("[PAYMENT] Erro AllowPay:", resp.status, data);
      return res.status(502).json({
        success: false,
        message: data?.error || data?.message || "Falha ao criar PIX",
        detalhes: data?.details || data?.detalhes || data?.errors,
      });
    }

    const txData = Array.isArray(data?.data) ? data.data[0] : data?.data || data;
    const tx = txData?.id || txData?.transaction_id || txData?.transactionId || txData?.txid;
    const pixInfo = Array.isArray(txData?.pix) ? txData.pix[0] : txData?.pix || {};
    const pixText =
      pixInfo?.emv ||
      pixInfo?.brcode ||
      pixInfo?.brCode ||
      pixInfo?.code ||
      pixInfo?.copy_and_paste ||
      pixInfo?.qrCode ||
      pixInfo?.qr_code ||
      pixInfo?.qrcode ||
      txData?.pix_code ||
      txData?.qr_code ||
      (typeof txData?.pix === "object" ? txData?.pix?.emv || txData?.pix?.qrCode || txData?.pix?.qr_code : "") ||
      "";
    let pixQr =
      pixInfo?.qrcode ||
      pixInfo?.qrCode ||
      pixInfo?.qr_code ||
      pixInfo?.qrcodeUrl ||
      pixInfo?.qrcode_url ||
      pixInfo?.qr_code_url ||
      pixInfo?.url ||
      pixInfo?.qr_code_image ||
      pixInfo?.qr_code_base64 ||
      txData?.pix_qr_code ||
      txData?.qr_code_image ||
      txData?.qr_code ||
      "";
    const looksLikeBase64 = (value) =>
      typeof value === "string" &&
      value.length > 100 &&
      /^[A-Za-z0-9+/=\s]+$/.test(value);
    if (!pixQr && typeof pixText === "string") {
      if (pixText.startsWith("http") || pixText.startsWith("data:image") || pixText.startsWith("base64,") || looksLikeBase64(pixText)) {
        pixQr = pixText;
      }
    }
    const normalizeQrUrl = (value) => {
      if (!value) return value;
      const withScheme = !value.startsWith("http") && value.includes("/")
        ? `https://${value}`
        : value;
      return withScheme.startsWith("http") ? encodeURI(withScheme) : withScheme;
    };
    const pixQrWithPrefix = pixQr
      ? pixQr.startsWith("data:image")
        ? pixQr
        : pixQr.startsWith("http")
          ? pixQr
          : pixQr.startsWith("base64,")
            ? `data:image/png;${pixQr}`
            : looksLikeBase64(pixQr)
              ? `data:image/png;base64,${pixQr.trim()}`
              : normalizeQrUrl(pixQr)
      : "";

    if (!tx || (!pixText && !pixQr)) {
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

    return res.status(200).json({
      success: true,
      transaction_id: String(tx),
      pix_code: String(pixText || pixQr),
      amount: txData?.amount || amountCents,
      status: String(txData?.status || "waiting_payment"),
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
