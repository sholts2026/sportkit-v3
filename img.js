// Vercel serverless function: scrapes the full Yupoo catalog
// ALL categories scraped in PARALLEL to stay within timeout.

const BASE = "https://abcd1234fei.x.yupoo.com";
const MAX_PAGES_PER = 5;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

let cache = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.query.debug === "1") {
    try {
      const cats = await fetchCategories();
      return res.status(200).json({ categories: cats, count: cats.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");

  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) {
    return res.status(200).json(cache);
  }

  try {
    const all = await scrapeFullCatalog();
    cache = all;
    cacheTime = Date.now();
    return res.status(200).json(all);
  } catch (e) {
    console.error("catalog error:", e);
    return res.status(500).json({ error: e.message, partial: cache || [] });
  }
}

async function scrapeFullCatalog() {
  // Step 1: Fetch main page to get categories list
  const categories = await fetchCategories();

  // Step 2: Build list of ALL URLs to scrape (main pages + categories, each with pagination)
  const urls = [];

  // Main albums pages
  for (let pg = 1; pg <= 15; pg++) {
    urls.push({ url: `${BASE}/albums?page=${pg}`, type: 'main' });
  }

  // Category pages (page 1-5 for each)
  for (const cat of categories) {
    for (let pg = 1; pg <= MAX_PAGES_PER; pg++) {
      urls.push({ url: `${BASE}/categories/${cat.id}?page=${pg}`, type: 'cat', cat: cat.name });
    }
  }

  // Step 3: Fetch ALL pages in parallel (batched to avoid overwhelming)
  const seen = new Set();
  const all = [];
  const BATCH = 15; // 15 concurrent requests

  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async ({ url }) => {
        try {
          const resp = await fetch(url, { headers: HEADERS });
          if (!resp.ok) return [];
          const html = await resp.text();
          return parseAlbums(html);
        } catch {
          return [];
        }
      })
    );

    let batchHadNewItems = false;
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const item of r.value) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          all.push(item);
          batchHadNewItems = true;
        }
      }
    }
  }

  return all;
}

async function fetchCategories() {
  const resp = await fetch(`${BASE}/albums`, { headers: HEADERS });
  if (!resp.ok) return [];
  const html = await resp.text();

  const cats = [];
  const re = /href="\/categories\/(\d+)(\?[^"]*)?"/gi;
  let m;
  const seenIds = new Set();
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    // Find the name near this link
    const idx = m.index;
    const nearby = html.slice(idx, idx + 300);
    const nameMatch = nearby.match(/>([^<]{2,50})</);
    const name = nameMatch ? nameMatch[1].trim() : id;

    // Skip utility pages
    const lower = name.toLowerCase();
    if (lower.includes('all categor') || lower.includes('size chart')) continue;

    cats.push({ id, name });
  }
  return cats;
}

function parseAlbums(html) {
  const items = [];
  const blockRe = /<a[^>]*class="album__main"[^>]*>[\s\S]*?<\/a>/gi;
  const blocks = html.match(blockRe) || [];

  for (const block of blocks) {
    const hrefMatch = block.match(/href="(\/albums\/[^"?]+)/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];

    const titleMatch = block.match(/title="([^"]+)"/i);
    const srcMatch = block.match(/src="(https?:\/\/photo\.yupoo\.com\/[^"]+)"/i);
    if (!srcMatch) continue;

    const altMatch = block.match(/alt="([^"]+)"/i);
    const name = (titleMatch?.[1] || altMatch?.[1] || "").replace(/\s+/g, " ").trim();
    if (!name || name.length < 2) continue;

    items.push({
      name,
      url: BASE + href,
      img: srcMatch[1],
    });
  }
  return items;
}
