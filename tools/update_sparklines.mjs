import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const INDEX_HTML = path.join(ROOT, "index.html");

const WINDOW_DAYS = 7;
const CONCURRENCY = 2;   // keep low to reduce rate-limits
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
    const s = m[1].trim();
    if (s) slugs.add(s);
  }
  return Array.from(slugs);
}

async function fetchJson(url, tries=5){
  let lastErr;
  for (let i=0;i<tries;i++){
    try{
      const res = await fetch(url, { headers: { "User-Agent": "rwa.watch-snapshot-bot" } });
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
  const tvlArr = Array.isArray(protocolJson?.tvl) ? protocolJson.tvl : [];
  if (!tvlArr.length) return dates.map(_ => 0);

  const map = new Map();
  for (const p of tvlArr){
    if (!p || typeof p.date !== "number") continue;
    const d = isoDateFromUnixDay(p.date);
    const v = Number(p.totalLiquidityUSD ?? p.totalLiquidityUsd ?? p.totalLiquidity ?? 0);
    map.set(d, isFinite(v) ? v : 0);
  }

  // fill missing days by carrying forward last known value
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

function pickPart(slugs, partIndex, partCount){
  const out = [];
  for (let i=0;i<slugs.length;i++){
    if ((i % partCount) === partIndex) out.push(slugs[i]);
  }
  return out;
}

function parseArgs(){
  const args = process.argv.slice(2);
  const out = { mode: "all", partIndex: 0, partCount: 1, outPath: "" };

  for (let i=0;i<args.length;i++){
    const a = args[i];
    if (a === "--mode") out.mode = args[++i];
    else if (a === "--part") {
      const [pi, pc] = String(args[++i]).split("/").map(x => parseInt(x,10));
      out.partIndex = pi;
      out.partCount = pc;
    } else if (a === "--out") out.outPath = args[++i];
  }

  if (!out.outPath) {
    out.outPath = out.mode === "rwa"
      ? path.join(ROOT, "data", "sparklines_rwa_7d.json")
      : path.join(ROOT, "data", "sparklines_all_7d.json");
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
        const url = `https://api.llama.fi/protocol/${encodeURIComponent(slug)}`;
        const pj = await fetchJson(url);
        series[slug] = buildSeriesFromProtocol(pj, dates);
      } catch(_){
        series[slug] = dates.map(_ => 0);
      }

      await sleep(SLEEP_MS);
    }
  }

  await Promise.all(Array.from({length: CONCURRENCY}, () => worker()));

  const payload = {
    generated_at: new Date().toISOString(),
    window_days: WINDOW_DAYS,
    dates,
    series
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2)); // pretty
  console.log("Wrote", outPath, "series:", Object.keys(series).length);
}

async function main(){
  const { mode, partIndex, partCount, outPath } = parseArgs();

  const html = fs.readFileSync(INDEX_HTML, "utf-8");
  const allSlugs = extractSlugsFromIndex(html);
  const dates = lastNDatesUTC(WINDOW_DAYS);

  // RWA set: reuse existing keys if available, so it's stable
  let rwaSlugs = null;
  const rwaFile = path.join(ROOT, "data", "sparklines_rwa_7d.json");
  try{
    const prev = JSON.parse(fs.readFileSync(rwaFile, "utf-8"));
    const keys = prev?.series ? Object.keys(prev.series) : [];
    if (keys.length) rwaSlugs = keys;
  } catch(_){}

  const base = (mode === "rwa") ? (rwaSlugs ?? allSlugs) : allSlugs;
  const slugs = (partCount > 1) ? pickPart(base, partIndex, partCount) : base;

  await buildSparklineFile(slugs, outPath, dates);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
