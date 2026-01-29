const db = require("../_db");

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ success: false, message: "Method Not Allowed" });
    }

    if (!db.getConnectionString()) {
      return res.status(500).json({ success: false, message: "Database not configured" });
    }

    const adminToken = process.env.ADMIN_TOKEN;
    const token = req.headers["x-admin-token"] || req.query.token || "";

    if (adminToken && token !== adminToken) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const limit = Math.min(Number(req.query.limit || 50), 200);
    const result = await db.query(
      "SELECT id, created_at, transaction_id, customer_name, customer_cpf, customer_email, file_url, file_name, size_bytes, mimetype, status FROM comprovantes ORDER BY created_at DESC LIMIT $1",
      [limit],
    );

    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("[COMPROVANTES LIST] erro:", error);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};
