mkdir -p tools
cat > tools/update_sparklines.mjs <<'EOF'
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const INDEX_HTML = path.join(ROOT, "index.html");
const OUT_RWA = path.join(ROOT, "data", "sparklines_rwa_7d.json");
const OUT_ALL = path.join(ROOT, "data", "sparklines_all_7d.json");

const WINDOW_DAYS = 7;
const CONCURRENCY = 6;
const SLEEP_MS = 250;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function isoDateFromUnixDay(unixSec){
  const d = new Date(unixSec * 1000);
  // yyyy-mm-dd in UTC
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function lastNDatesUTC(n){
  // use today UTC date at 00:00
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

function extractSlugsFromIndex(html){
  // We collect all "slug": "..." occurrences, then unique.
  const re = /"slug"\s*:\s*"([^"]+)"/g;
  const slugs = new Set();
  let m;
  while ((m = re.exec(html)) !== null){
    const s = m[1].trim();
    if (s) slugs.add(s);
  }
  return Array.from(slugs);
}

async function fetchJson(url, tries=4){
  let lastErr;
  for (let i=0;i<tries;i++){
    try{
      const res = await fetch(url, { headers: { "User-Agent": "rwa.watch-snapshot-bot" } });
      if (res.status === 429){
        // rate limit
        await sleep(1200 + i*800);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch(e){
      lastErr = e;
      await sleep(800 + i*700);
    }
  }
  throw lastErr;
}

function buildSeriesFromProtocol(protocolJson, dates){
  // DeFiLlama /protocol/<slug> typically returns protocolJson.tvl as [{date, totalLiquidityUSD}, ...]
  const tvlArr = Array.isArray(protocolJson?.tvl) ? protocolJson.tvl : [];
  if (!tvlArr.length) return dates.map(_ => 0);

  // Map date -> value
  const map = new Map();
  for (const p of tvlArr){
    if (!p || typeof p.date !== "number") continue;
    const d = isoDateFromUnixDay(p.date);
    const v = Number(p.totalLiquidityUSD ?? p.totalLiquidityUsd ?? p.totalLiquidity ?? 0);
    map.set(d, isFinite(v) ? v : 0);
  }

  // Fill values, carrying forward last known value (common for missing days)
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

async function buildSparklineFile(slugs, outPath, dates){
  const series = {};
  let idx = 0;

  async function worker(){
    while (true){
      const i = idx++;
      if (i >= slugs.length) return;
      const slug = slugs[i];

      try{
        // protocol endpoint
        const url = `https://api.llama.fi/protocol/${encodeURIComponent(slug)}`;
        const pj = await fetchJson(url);
        series[slug] = buildSeriesFromProtocol(pj, dates);
      } catch(e){
        // keep file usable even on failures
        series[slug] = dates.map(_ => 0);
      }

      await sleep(SLEEP_MS);
    }
  }

  const workers = Array.from({length: CONCURRENCY}, () => worker());
  await Promise.all(workers);

  const payload = {
    generated_at: new Date().toISOString(),
    window_days: WINDOW_DAYS,
    dates,
    series
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log("Wrote", outPath, "series:", Object.keys(series).length);
}

async function main(){
  const html = fs.readFileSync(INDEX_HTML, "utf-8");
  const allSlugs = extractSlugsFromIndex(html);

  // RWA vs ALL: simplest pragmatic split
  // - RWA sparkline: slugs that appear in the RWA dataset block AND have protocol_category "RWA" somewhere
  // Because index.html contains BOTH lists, we approximate by reading existing files if they exist.
  // If existing RWA file exists, we reuse its keys as the "RWA set". Otherwise, we just use all slugs.
  let rwaSlugs = null;
  try{
    const prev = JSON.parse(fs.readFileSync(OUT_RWA, "utf-8"));
    const keys = prev?.series ? Object.keys(prev.series) : [];
    if (keys.length) rwaSlugs = keys;
  } catch(_){}

  const dates = lastNDatesUTC(WINDOW_DAYS);

  const slugsAll = allSlugs;
  const slugsRwa = rwaSlugs ?? allSlugs;

  await buildSparklineFile(slugsRwa, OUT_RWA, dates);
  await buildSparklineFile(slugsAll, OUT_ALL, dates);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
EOF
