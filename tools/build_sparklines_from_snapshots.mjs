import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function readJson(p){
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function lastNDatesUTC(n){
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out = [];
  for (let i=n-1;i>=0;i--){
    const t = new Date(base - i*24*3600*1000);
    const y=t.getUTCFullYear();
    const m=String(t.getUTCMonth()+1).padStart(2,"0");
    const d=String(t.getUTCDate()).padStart(2,"0");
    out.push(`${y}-${m}-${d}`);
  }
  return out;
}

function main(){
  const snapsDir = path.join(ROOT, "data", "snapshots7d");
  const dates = lastNDatesUTC(7);

  // Load daily snapshots
  const daily = dates.map(dt => {
    const p = path.join(snapsDir, `${dt}.json`);
    if (!fs.existsSync(p)) throw new Error(`Missing snapshot file: ${p}`);
    const j = readJson(p);
    const assets = Array.isArray(j.assets) ? j.assets : [];
    // map slug -> tvl
    const m = new Map();
    for (const a of assets){
      const slug = a.slug || a.asset_id || a.asset_key;
      if (!slug) continue;
      const tvl = Number(a.tvl_usd);
      m.set(slug, Number.isFinite(tvl) ? tvl : 0);
    }
    return { dt, map: m, raw: j };
  });

  // Union of slugs across the 7 days
  const allSlugs = new Set();
  for (const d of daily) for (const k of d.map.keys()) allSlugs.add(k);

  // Build series
  const seriesAll = {};
  for (const slug of allSlugs){
    const arr = [];
    let last = 0;
    for (const d of daily){
      const v = d.map.has(slug) ? d.map.get(slug) : last;
      last = v;
      arr.push(v);
    }
    seriesAll[slug] = arr;
  }

  // RWA subset: use latest day snapshot flag/category if present
  const latestAssets = Array.isArray(daily[daily.length-1].raw.assets) ? daily[daily.length-1].raw.assets : [];
  const rwaSet = new Set();
  for (const a of latestAssets){
    const slug = a.slug || a.asset_id || a.asset_key;
    if (!slug) continue;
    // keep simple: protocol_category === "RWA" OR category === "RWA"
    if (a.protocol_category === "RWA" || a.category === "RWA") rwaSet.add(slug);
  }

  const seriesRwa = {};
  for (const slug of rwaSet){
    if (seriesAll[slug]) seriesRwa[slug] = seriesAll[slug];
  }

  const outAll = {
    generated_at: new Date().toISOString(),
    window_days: 7,
    dates,
    series: seriesAll
  };
  const outRwa = {
    generated_at: new Date().toISOString(),
    window_days: 7,
    dates,
    series: seriesRwa
  };

  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data", "sparklines_all_7d.json"), JSON.stringify(outAll, null, 2));
  fs.writeFileSync(path.join(ROOT, "data", "sparklines_rwa_7d.json"), JSON.stringify(outRwa, null, 2));

  console.log("Wrote sparklines_all_7d.json series:", Object.keys(seriesAll).length);
  console.log("Wrote sparklines_rwa_7d.json series:", Object.keys(seriesRwa).length);
}

main();
