const STATUS_URL = process.env.SEALPAY_STATUS_URL || "";

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

    if (!STATUS_URL) {
      return res.status(200).json({
        success: true,
        status: "PENDING",
        message: "Consulta de status não configurada para SealPay",
        transaction: { txid: id },
      });
    }

    const id = String(req.query.id || req.query.transaction_id || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "id é obrigatório" });

    const url = `${STATUS_URL.replace(/\/$/, "")}/${encodeURIComponent(id)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      const status = data?.status || data?.payment_status || "PENDING";
      return res.json({ success: true, status, transaction: data });
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
