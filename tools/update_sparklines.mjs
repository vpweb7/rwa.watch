import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const WINDOW_DAYS = 7;
const CONCURRENCY = 2;   // kíméletes (ne tiltson)
const SLEEP_MS = 250;

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

function pickPart(arr, partIndex, partCount){
  const out = [];
  for (let i=0;i<arr.length;i++){
    if ((i % partCount) === partIndex) out.push(arr[i]);
  }
  return out;
}

async function fetchJson(url, tries=5){
  let lastErr;
  for (let i=0;i<tries;i++){
    try{
      const res = await fetch(url, { headers: { "User-Agent": "rwa.watch-sparklines-bot" } });
      if (res.status === 429){
        await sleep(2000 + i*1500);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch(e){
      lastErr = e;
      await sleep(1200 + i*1200);
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
    map.set(d, Number.isFinite(v) ? v : 0);
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

// >>> KEY CHANGE: slugs come from data/dataset.json (full universe)
function loadSlugs(){
  const p = path.join(ROOT, "data", "dataset.json");
  if (!fs.existsSync(p)) throw new Error("Missing data/dataset.json. Run Update dataset first.");
  const j = JSON.parse(fs.readFileSync(p, "utf-8"));
  const assets = Array.isArray(j.assets) ? j.assets : [];
  const slugs = assets.map(a => a && (a.slug || a.id)).filter(Boolean);
  if (!slugs.length) throw new Error("No slugs found in data/dataset.json");
  return slugs;
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
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log("Wrote", outPath, "series:", Object.keys(series).length);
}

async function main(){
  const { mode, partIndex, partCount, outPath } = parseArgs();

  // ALL = full dataset universe
  const allSlugs = loadSlugs();
  const dates = lastNDatesUTC(WINDOW_DAYS);

  const base = allSlugs;
  const slugs = (partCount > 1) ? pickPart(base, partIndex, partCount) : base;

  console.log(`Sparklines build: mode=${mode} part=${partIndex}/${partCount} slugs=${slugs.length} total=${base.length}`);

  await buildSparklineFile(slugs, outPath, dates);
}

main().catch(e => { console.error(e); process.exit(1); });
