// api/utmify-webhook.js
// Chama UTMify quando pagamento é confirmado via webhook AllowPay

const { sendUtmifyEvent } = require("./utmify");
const db = require("../_db");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    let body = req.body;
    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const data = Array.isArray(body?.data) ? body.data[0] : body?.data || body;
    const status = (data?.status || body?.status || "").toString().toLowerCase();
    const id = data?.id || body?.objectId || body?.id || data?.transaction_id || "";

    // Busca lead para dados do cliente e UTM
    let lead = null;
    if (id && db.getConnectionString()) {
      const result = await db.query("SELECT * FROM leads WHERE transaction_id = $1 LIMIT 1", [String(id)]);
      lead = result.rows[0];
    }

    if (status === "paid" && id && lead) {
      // Envia evento para UTMify
      await sendUtmifyEvent({
        order_id: id,
        status: "paid",
        name: lead.nome,
        email: lead.email,
        phone: lead.phone,
        utm_source: lead.tracking?.utm_source || undefined,
        utm_medium: lead.tracking?.utm_medium || undefined,
        utm_campaign: lead.tracking?.utm_campaign || undefined,
        utm_term: lead.tracking?.utm_term || undefined,
        utm_content: lead.tracking?.utm_content || undefined,
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[UTMIFY WEBHOOK] erro:", error);
    return res.status(500).json({ success: false });
  }
};
