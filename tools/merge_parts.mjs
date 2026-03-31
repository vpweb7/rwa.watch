import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function readJson(p){
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function main(){
  const partsDir = path.join(ROOT, "data", "parts");
  const outDataset = path.join(ROOT, "data", "dataset.json");

  const files = fs.readdirSync(partsDir)
    .filter(f => f.startsWith("dataset_part_") && f.endsWith(".json"))
    .sort((a,b) => {
      const ai = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const bi = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return ai - bi;
    });

  if (!files.length) throw new Error("No dataset parts found in data/parts");

  const assets = [];
  let windowDays = 7;

  for (const f of files){
    const j = readJson(path.join(partsDir, f));
    if (typeof j.window_days === "number") windowDays = j.window_days;
    if (Array.isArray(j.assets)) assets.push(...j.assets);
  }

  // global sort: biggest first
  assets.sort((a,b) => (Number(b.tvl_usd) || 0) - (Number(a.tvl_usd) || 0));

  const merged = {
    generated_at: new Date().toISOString(),
    version: "public-dataset-v2-parted",
    definition: "Monitoring dataset (public). Built from dataset parts.",
    integrity_rules: { window_days: windowDays },
    assets
  };

  fs.writeFileSync(outDataset, JSON.stringify(merged, null, 2));
  console.log("Merged dataset parts:", files.length, "assets:", assets.length);
}

main();
