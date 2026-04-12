// tools/fill_dataset_7d_from_sparklines.mjs
import fs from "fs";

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function firstPositive(arr) {
  for (const v of arr) {
    const n = num(v);
    if (n !== null && n > 0) return n;
  }
  return null;
}

function lastFinite(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const n = num(arr[i]);
    if (n !== null) return n;
  }
  return null;
}

const datasetPath = "data/dataset.json";
const sparkPath = "data/sparklines_all_7d.json";

if (!fs.existsSync(datasetPath)) {
  console.error("Missing", datasetPath);
  process.exit(1);
}
if (!fs.existsSync(sparkPath)) {
  console.error("Missing", sparkPath, "(sparklines must exist in repo)");
  process.exit(1);
}

const ds = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
const sp = JSON.parse(fs.readFileSync(sparkPath, "utf8"));
const series = sp.series || {};

const assets = ds.assets || [];
let filled = 0;
let skippedNoSeries = 0;
let skippedNoData = 0;

for (const a of assets) {
  const has7d = Number.isFinite(Number(a?.tvl_change_7d_pct));
  if (has7d) continue;

  const key = a?.slug || a?.id;
  const arr = key ? series[key] : null;
  if (!Array.isArray(arr) || arr.length < 2) {
    skippedNoSeries++;
    continue;
  }

  const first = firstPositive(arr);
  const last = lastFinite(arr);
  if (first === null || last === null || first <= 0) {
    skippedNoData++;
    continue;
  }

  const pct = ((last - first) / first) * 100;
  if (!Number.isFinite(pct)) {
    skippedNoData++;
    continue;
  }

  a.tvl_change_7d_pct = pct;
  filled++;
}

ds.assets = assets;
// opcionális: tükrözheted a timestampet is
ds.spark_generated_at = sp.generated_at || null;

fs.writeFileSync(datasetPath, JSON.stringify(ds));
console.log(
  `Filled tvl_change_7d_pct: ${filled} | no series: ${skippedNoSeries} | no usable data: ${skippedNoData}`
);
