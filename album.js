// Image proxy fallback. Fetches from Yupoo with proper Referer, streams back.

export default async function handler(req, res) {
  const url = req.query.u;
  if (!url || !/^https?:\/\/[^/]*yupoo\.com\//i.test(url)) {
    return res.status(400).send("bad url");
  }

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Referer": "https://abcd1234fei.x.yupoo.com/",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (!resp.ok) return res.status(resp.status).send("upstream error");

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await resp.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=2592000, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).send(buffer);
  } catch (e) {
    return res.status(500).send("fetch failed: " + e.message);
  }
}
