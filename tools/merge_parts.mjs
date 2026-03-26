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
    .sort((a,b) => a.localeCompare(b));

  if (!files.length) throw new Error("No parts found in data/parts");

  const first = readJson(path.join(partsDir, files[0]));
  const merged = {
    generated_at: new Date().toISOString(),
    window_days: first.window_days,
    dates: first.dates,
    series: {}
  };

  for (const f of files){
    const j = readJson(path.join(partsDir, f));
    for (const [k,v] of Object.entries(j.series || {})){
      merged.series[k] = v;
    }
  }

  fs.writeFileSync(outAll, JSON.stringify(merged, null, 2)); // pretty
  console.log("Merged parts:", files.length, "series:", Object.keys(merged.series).length);
}

main();
