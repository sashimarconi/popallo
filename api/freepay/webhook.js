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
    const status = data?.status || body?.status || "";
    const id = data?.id || data?.transaction_id || body?.id || "";

    console.log("[FREEPAY WEBHOOK]", { id, status, payload: body });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[FREEPAY WEBHOOK] erro:", error);
    return res.status(500).json({ success: false });
  }
};
