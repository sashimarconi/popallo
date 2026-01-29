// SealPay API Integration v1.0
// Pagamento via PIX com SealPay Gateway

const BASE_URL = process.env.SEALPAY_BASE_URL || "https://abacate-5eo1.onrender.com";

async function handlePaymentRequest(req, res) {
  // Handle OPTIONS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const API_KEY = process.env.SEALPAY_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({ 
        success: false, 
        message: "Chave da SealPay não configurada" 
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

    const payload = {
      amount: amountCents,
      description: FIXED_TITLE,
      customer,
      tracking,
      api_key: API_KEY,
      fbp: bodyData.fbp || "",
      fbc: bodyData.fbc || "",
      user_agent: bodyData.user_agent || req.headers["user-agent"] || "",
    };

    console.log("[PAYMENT] Enviando para SealPay...");

    const resp = await fetch(`${BASE_URL}/create-pix`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("[PAYMENT] Erro SealPay:", resp.status, data);
      return res.status(502).json({
        success: false,
        message: data?.error || "Falha ao criar PIX",
        detalhes: data?.detalhes,
      });
    }

    const tx = data?.txid || data?.id;
    const pixText = data?.pix_code || data?.pixCode || "";
    const pixQr = data?.pix_qr_code || data?.pixQrCode || "";
    const pixQrWithPrefix = pixQr && pixQr.startsWith("data:image")
      ? pixQr
      : (pixQr ? `data:image/png;base64,${pixQr}` : "");

    if (!tx || !pixText) {
      return res.status(502).json({
        success: false,
        message: "Gateway não retornou dados esperados",
      });
    }

    return res.status(200).json({
      success: true,
      transaction_id: String(tx),
      pix_code: String(pixText),
      amount: data?.amount || amountCents,
      status: String(data?.status || "PENDING"),
      qr_code: pixQrWithPrefix || String(pixText),
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
