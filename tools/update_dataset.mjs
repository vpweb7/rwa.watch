import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "dataset.json");

async function fetchJson(url, tries=5){
  let lastErr;
  for (let i=0;i<tries;i++){
    try{
      const res = await fetch(url, { headers: { "User-Agent": "rwa.watch-dataset-bot" } });
      if (res.status === 429){
        await new Promise(r=>setTimeout(r, 1500 + i*1500));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch(e){
      lastErr = e;
      await new Promise(r=>setTimeout(r, 800 + i*800));
    }
  }
  throw lastErr;
}

function num(x){ const n = Number(x); return Number.isFinite(n) ? n : 0; }

async function main(){
  console.log("Fetching DefiLlama protocols list...");
  const list = await fetchJson("https://api.llama.fi/protocols");

  if (!Array.isArray(list)) throw new Error("Expected array from /protocols");

  const assets = list
    .filter(p => p && p.slug)
    .map(p => ({
      id: p.slug,
      name: p.name ?? p.slug,
      slug: p.slug,
      logo: p.logo ?? null,
      chains: Array.isArray(p.chains) ? p.chains : [],
      protocol_category: p.category ?? null,
      tvl_usd: num(p.tvl),
      // DefiLlama /protocols sokszor ad change_7d / change_1d mezőket – ha nincs, null marad
      tvl_change_7d_pct: (p.change_7d !== undefined && p.change_7d !== null) ? num(p.change_7d) : null,
      tvl_change_1d_pct: (p.change_1d !== undefined && p.change_1d !== null) ? num(p.change_1d) : null,
    }))
    .sort((a,b)=> (b.tvl_usd||0)-(a.tvl_usd||0));

  const payload = {
    generated_at: new Date().toISOString(),
    source: "https://api.llama.fi/protocols",
    assets_count: assets.length,
    assets
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log("Wrote", OUT, "assets:", assets.length);
}

main().catch(e => { console.error(e); process.exit(1); });
