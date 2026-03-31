const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const INDEX_HTML = path.join(ROOT, "index.html");

const WINDOW_DAYS = 7;
const CONCURRENCY = 2;
const SLEEP_MS = 200;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function lastNDatesUTC(n){
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out = [];
  for (let i = n-1; i >= 0; i--){
    const t = new Date(base - i*24*3600*1000);
    const y = t.getUTCFullYear();
    const m = String(t.getUTCMonth()+1).padStart(2,"0");
    const d = String(t.getUTCDate()).padStart(2,"0");
    out.push(`${y}-${m}-${d}`);
  }
  return out;
}

function isoDateFromUnixDay(unixSec){
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function extractSlugsFromIndex(html){
  const re = /"slug"\s*:\s*"([^"]+)"/g;
  const slugs = new Set();
  let m;
  while ((m = re.exec(html)) !== null){
    const s = String(m[1] || "").trim();
    if (s) slugs.add(s);
  }
  return Array.from(slugs);
}

// Node <18: no global fetch. We'll polyfill if needed.
async function fetchJson(url, tries=5){
  let fetchFn = global.fetch;
  if (!fetchFn){
    // lazy-load node-fetch (GitHub Actions Node20 has global fetch, so this is mainly for local)
    fetchFn = (await import("node-fetch")).default;
  }

  let lastErr;
  for (let i=0;i<tries;i++){
    try{
      const res = await fetchFn(url, { headers: { "User-Agent": "rwa.watch-dataset-bot" } });
      if (res.status === 429){
        await sleep(1500 + i*1200);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch(e){
      lastErr = e;
      await sleep(900 + i*900);
    }
  }
  throw lastErr;
}

function buildSeriesFromProtocol(protocolJson, dates){
  const tvlArr = (protocolJson && Array.isArray(protocolJson.tvl)) ? protocolJson.tvl : [];
  if (!tvlArr.length) return dates.map(_ => 0);

  const map = new Map();
  for (const p of tvlArr){
    if (!p || typeof p.date !== "number") continue;
    const d = isoDateFromUnixDay(p.date);
    const v = Number(
      (p.totalLiquidityUSD != null) ? p.totalLiquidityUSD :
      (p.totalLiquidityUsd != null) ? p.totalLiquidityUsd :
      (p.totalLiquidity != null) ? p.totalLiquidity :
      0
    );
    map.set(d, isFinite(v) ? v : 0);
  }

  const out = [];
  let last = 0;
  for (const d of dates){
    if (map.has(d)){
      last = map.get(d);
      out.push(last);
    } else {
      out.push(last);
    }
  }
  return out;
}

function pctChange(today, past){
  if (!isFinite(today) || !isFinite(past) || past <= 0) return null;
  return ((today - past) / past) * 100;
}

function parseArgs(){
  const args = process.argv.slice(2);
  const out = { outPath: "" };
  for (let i=0;i<args.length;i++){
    const a = args[i];
    if (a === "--out") out.outPath = args[++i];
  }
  if (!out.outPath) out.outPath = path.join(ROOT, "data", "dataset.json");
  return out;
}

function getStr(obj, key, fallback=null){
  if (!obj) return fallback;
  const v = obj[key];
  return (typeof v === "string" && v.trim()) ? v : fallback;
}

function getArr(obj, key){
  if (!obj) return [];
  const v = obj[key];
  return Array.isArray(v) ? v : [];
}

async function main(){
  const { outPath } = parseArgs();

  const html = fs.readFileSync(INDEX_HTML, "utf-8");
  const slugs = extractSlugsFromIndex(html);
  const dates = lastNDatesUTC(WINDOW_DAYS);

  const assets = [];
  let idx = 0;

  async function worker(){
    while (true){
      const i = idx++;
      if (i >= slugs.length) return;
      const slug = slugs[i];

      const defillamaUrl = `https://defillama.com/protocol/${encodeURIComponent(slug)}`;
      const apiUrl = `https://api.llama.fi/protocol/${encodeURIComponent(slug)}`;

      try{
        const pj = await fetchJson(apiUrl);

        const s = buildSeriesFromProtocol(pj, dates);
        const today = (s.length ? s[s.length - 1] : 0) || 0;
        const past7 = (s.length ? s[0] : 0) || 0;
        const chg7 = pctChange(today, past7);

        assets.push({
          id: slug,
          name: getStr(pj, "name", slug),
          slug,
          logo: getStr(pj, "logo", null),
          chains: getArr(pj, "chains"),
          protocol_category: getStr(pj, "category", null),
          tvl_usd: today,
          tvl_change_7d_pct: chg7,
          confidence: "LOW",
          yield_coverage_pct: null,
          flag_low_yield_coverage: false,
          reported_high_apy_detected: false,
          reported_strong_apy_detected: false,
          defillama_url: defillamaUrl,
          project_url: getStr(pj, "url", null)
        });
      } catch(e){
        assets.push({
          id: slug,
          name: slug,
          slug,
          logo: null,
          chains: [],
          protocol_category: null,
          tvl_usd: 0,
          tvl_change_7d_pct: null,
          confidence: "LOW",
          yield_coverage_pct: null,
          flag_low_yield_coverage: false,
          reported_high_apy_detected: false,
          reported_strong_apy_detected: false,
          defillama_url: defillamaUrl,
          project_url: null
        });
      }

      await sleep(SLEEP_MS);
    }
  }

  await Promise.all(Array.from({length: CONCURRENCY}, () => worker()));
  assets.sort((a,b) => (Number(b.tvl_usd) || 0) - (Number(a.tvl_usd) || 0));

  const payload = {
    generated_at: new Date().toISOString(),
    version: "public-dataset-v1",
    definition: "Monitoring dataset (public).",
    integrity_rules: { window_days: WINDOW_DAYS },
    assets
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log("Wrote", outPath, "assets:", assets.length);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
