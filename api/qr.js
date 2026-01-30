module.exports = async function handler(req, res) {
  try {
    const url = req.query.u;
    if (!url) {
      return res.status(400).json({ error: "Missing url" });
    }

    const raw = Array.isArray(url) ? url[0] : url;
    const target = raw.trim().split(/\s+/)[0];
    const targetNoScheme = target.replace(/^https?:\/\//i, "");
    if (targetNoScheme.startsWith("000201")) {
      return res.status(400).json({ error: "Invalid url" });
    }
    if (!/^https?:\/\//i.test(target)) {
      return res.status(400).json({ error: "Invalid url" });
    }
    try {
      new URL(target);
    } catch {
      return res.status(400).json({ error: "Invalid url" });
    }

    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch QR" });
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("[QR] Error fetching QR:", error.message);
    return res.status(502).json({ error: "Upstream error" });
  }
};
