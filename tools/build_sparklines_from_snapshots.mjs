import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function readJson(p){
  const t = fs.readFileSync(p, "utf-8");
  const clean = t.replace(/\bNaN\b/g, "null").replace(/\b-Infinity\b/g,"null").replace(/\bInfinity\b/g,"null");
  return JSON.parse(clean);
}

function main(){
  const snapsDir = path.join(ROOT, "data", "snapshots7d");
  if (!fs.existsSync(snapsDir)) throw new Error(`snapshots folder not found: ${snapsDir}`);

  // Use ALL downloaded date-named snapshots in this folder (should already be <= 7)
  const files = fs.readdirSync(snapsDir)
    .filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort();

  if (files.length < 2) throw new Error(`Not enough snapshot files in ${snapsDir}. Found: ${files.length}`);

  console.log("Using snapshot files:", files.join(", "));

  const dates = files.map(f => f.replace(".json",""));

  const daily = files.map(fname => {
    const j = readJson(path.join(snapsDir, fname));
    const assets = Array.isArray(j.assets) ? j.assets : [];
    const m = new Map();
    for (const a of assets){
      const slug = a.slug || a.asset_id || a.asset_key;
      if (!slug) continue;
      const tvl = Number(a.tvl_usd);
      m.set(slug, Number.isFinite(tvl) ? tvl : 0);
    }
    return { raw: j, map: m };
  });

  const allSlugs = new Set();
  for (const d of daily) for (const k of d.map.keys()) allSlugs.add(k);

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

  const latestAssets = Array.isArray(daily[daily.length-1].raw.assets) ? daily[daily.length-1].raw.assets : [];
  const rwaSet = new Set();
  for (const a of latestAssets){
    const slug = a.slug || a.asset_id || a.asset_key;
    if (!slug) continue;
    if (a.protocol_category === "RWA" || a.category === "RWA") rwaSet.add(slug);
  }

  const seriesRwa = {};
  for (const slug of rwaSet){
    if (seriesAll[slug]) seriesRwa[slug] = seriesAll[slug];
  }

  const outAll = { generated_at: new Date().toISOString(), window_days: dates.length, dates, series: seriesAll };
  const outRwa = { generated_at: new Date().toISOString(), window_days: dates.length, dates, series: seriesRwa };

  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data", "sparklines_all_7d.json"), JSON.stringify(outAll, null, 2));
  fs.writeFileSync(path.join(ROOT, "data", "sparklines_rwa_7d.json"), JSON.stringify(outRwa, null, 2));

  console.log("Dates:", dates.join(", "));
  console.log("All series:", Object.keys(seriesAll).length);
  console.log("RWA series:", Object.keys(seriesRwa).length);
}

main();
