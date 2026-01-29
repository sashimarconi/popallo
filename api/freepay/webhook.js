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
    const id = data?.id || data?.transaction_id || body?.id || "";

    console.log("[FREEPAY WEBHOOK]", { id, status, payload: body });

    if (status === "paid" && id && db.getConnectionString()) {
      await db.query("UPDATE leads SET status = $1 WHERE transaction_id = $2", ["PAID", String(id)]);
      await db.query("UPDATE comprovantes SET status = $1 WHERE transaction_id = $2", ["paid", String(id)]);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[FREEPAY WEBHOOK] erro:", error);
    return res.status(500).json({ success: false });
  }
};
