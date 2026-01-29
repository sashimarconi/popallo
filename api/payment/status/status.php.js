const BASE_URL = process.env.FREEPAY_BASE_URL || "https://api.freepaybrasil.com";

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    const FREEPAY_USERNAME = process.env.FREEPAY_USERNAME;
    const FREEPAY_PASSWORD = process.env.FREEPAY_PASSWORD;
    if (!FREEPAY_USERNAME || !FREEPAY_PASSWORD) {
      return res.status(500).json({ success: false, message: "Credenciais da FreePay não configuradas" });
    }

    const id = String(req.query.id || req.query.transaction_id || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "id é obrigatório" });

    const url = `${BASE_URL}/v1/payment-transaction/info/${encodeURIComponent(id)}`;

    const authHeader = Buffer.from(`${FREEPAY_USERNAME}:${FREEPAY_PASSWORD}`).toString("base64");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${authHeader}`,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      const txData = Array.isArray(data?.data) ? data.data[0] : data?.data || data;
      const status = txData?.status || data?.status || data?.payment_status || "PENDING";
      return res.json({ success: true, status, transaction: txData || data });
    }

    return res.status(502).json({
      success: false,
      message: "Não foi possível consultar status",
      response: { status: response.status, data },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Erro interno", error: String(e?.message || e) });
  }
};
