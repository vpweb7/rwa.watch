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

const EPS = 1e-12;

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
let filledPct = 0;
let filledLabel = 0;
let skippedNoSeries = 0;
let skippedAlreadyHas = 0;

for (const a of assets) {
  // 1) Ha már van értelmes 7D% (nem 0), hagyjuk
  const cur = num(a?.tvl_change_7d_pct);
  const hasMeaningful7d = cur !== null && Math.abs(cur) > EPS;
  if (hasMeaningful7d) {
    // ha korábbról maradt label, nem baj, de takaríthatjuk is
    // delete a.tvl_change_7d_label;
    skippedAlreadyHas++;
    continue;
  }

  const key = a?.slug || a?.id;
  const arr = key ? series[key] : null;
  if (!Array.isArray(arr) || arr.length < 2) {
    skippedNoSeries++;
    continue;
  }

  const first = firstPositive(arr);
  const last = lastFinite(arr);

  // 2) Ha van baseline és last, számolunk %-ot
  if (first !== null && last !== null && first > 0) {
    const pct = ((last - first) / first) * 100;
    if (Number.isFinite(pct)) {
      a.tvl_change_7d_pct = pct;
      // siker esetén labelt eldobhatjuk
      if (a.tvl_change_7d_label) delete a.tvl_change_7d_label;
      filledPct++;
      continue;
    }
  }

  // 3) Ha nem számolható, adjunk labelt N/A helyett
  // - ha last>0, de nincs baseline -> NEW (tipikusan frissen induló)
  // - ha last==0 -> FLAT
  // - különben NO_BASE
  if (last !== null && last > 0 && (first === null || first <= 0)) {
    a.tvl_change_7d_label = "NEW";
    filledLabel++;
  } else if (last !== null && Math.abs(last) <= EPS) {
    a.tvl_change_7d_label = "FLAT";
    filledLabel++;
  } else {
    a.tvl_change_7d_label = "NO_BASE";
    filledLabel++;
  }
}

ds.assets = assets;
ds.spark_generated_at = sp.generated_at || null;

fs.writeFileSync(datasetPath, JSON.stringify(ds));
console.log(
  `Filled pct: ${filledPct} | labeled: ${filledLabel} | already-had(nonzero): ${skippedAlreadyHas} | no series: ${skippedNoSeries}`
);
