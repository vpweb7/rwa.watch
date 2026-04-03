import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function readJson(p){
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function main(){
  const partsDir = path.join(ROOT, "data", "parts");
  const outAll = path.join(ROOT, "data", "sparklines_all_7d.json");

  const files = fs.readdirSync(partsDir)
    .filter(f => f.startsWith("all_part_") && f.endsWith(".json"))
    .sort((a,b) => {
      const ai = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const bi = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return ai - bi;
    });

  if (!files.length) throw new Error("No sparklines parts found in data/parts (expected all_part_*.json)");

  let windowDays = 7;
  let dates = null;
  const series = {};

  for (const f of files){
    const j = readJson(path.join(partsDir, f));
    if (typeof j.window_days === "number") windowDays = j.window_days;
    if (Array.isArray(j.dates) && !dates) dates = j.dates;
    if (j.series && typeof j.series === "object"){
      for (const [k,v] of Object.entries(j.series)){
        series[k] = v;
      }
    }
  }

  if (!dates) {
    // try to derive from any series length (fallback)
    const firstKey = Object.keys(series)[0];
    const n = firstKey ? (series[firstKey]?.length ?? windowDays) : windowDays;
    dates = Array.from({length:n}, (_,i)=> String(i));
  }

  const merged = {
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    dates,
    series
  };

  fs.writeFileSync(outAll, JSON.stringify(merged, null, 2));
  console.log("Merged sparklines parts:", files.length, "series:", Object.keys(series).length);
}

main();
