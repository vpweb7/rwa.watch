import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function main() {
  const partsDir = path.join(ROOT, "data", "parts");
  const outFile = path.join(ROOT, "data", "sparklines_all_7d.json");

  const files = fs.readdirSync(partsDir)
    .filter(f => f.startsWith("all_part_") && f.endsWith(".json"))
    .sort((a, b) => {
      const ai = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const bi = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return ai - bi;
    });

  if (!files.length) throw new Error("No ALL sparklines parts found in data/parts (expected all_part_*.json)");

  const series = {};
  let windowDays = 7;
  let definition = "ALL sparklines (7d). Built from DefiLlama parts.";
  let version = "public-sparklines-all-v1-parted";

  for (const f of files) {
    const j = readJson(path.join(partsDir, f));

    if (typeof j.window_days === "number") windowDays = j.window_days;
    if (typeof j.definition === "string") definition = j.definition;
    if (typeof j.version === "string") version = j.version;

    // Accept either { series: {...} } or raw object map
    const partSeries =
      (j && typeof j === "object" && j.series && typeof j.series === "object") ? j.series :
      (j && typeof j === "object") ? j : null;

    if (!partSeries || typeof partSeries !== "object") {
      throw new Error(`Part ${f} has no usable series object`);
    }

    for (const [k, v] of Object.entries(partSeries)) {
      // last write wins, but keys should be unique across parts
      series[k] = v;
    }
  }

  const merged = {
    generated_at: new Date().toISOString(),
    version,
    definition,
    window_days: windowDays,
    series
  };

  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2));
  console.log("Merged ALL sparklines parts:", files.length, "series:", Object.keys(series).length);
}

main();
