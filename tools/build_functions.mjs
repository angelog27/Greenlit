// Copies the game model (the MODEL section of Frontend/greenlight.html) and data/*.json into functions/gen/,
// so the Cloud Functions score films with exactly the code the page runs. VERSION is a hash of the model and
// the roster data (the roster version stored with each score); the campaign config is copied but not hashed,
// so tuning it never changes the roster version. Runs automatically before `firebase deploy` (firebase.json).
// Safe to run concurrently (the tests do): it skips when gen/ is current and replaces files atomically.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "functions", "gen");
const FILES = ["genres", "directors", "actors", "plots", "windows", "loyal", "chem", "slate"];
const EXTRA = ["campaign", "achievements", "identity", "awards"];

const html = fs.readFileSync(path.join(ROOT, "Frontend", "greenlight.html"), "utf8");
const a = html.indexOf("// ===== MODEL START ====="), b = html.indexOf("// ===== MODEL END =====");
if (a < 0 || b < 0) throw new Error("model markers not found in Frontend/greenlight.html");
const out = { "model.js": html.slice(a, b) };
const h = crypto.createHash("sha256").update(out["model.js"]);
for (const n of FILES.concat(EXTRA)) {
  const txt = fs.readFileSync(path.join(ROOT, "data", n + ".json"), "utf8");
  out[path.join("data", n + ".json")] = txt;
  if (FILES.includes(n)) h.update(txt);
}
const version = h.digest("hex").slice(0, 12);
out.VERSION = version + "\n";

const same = Object.entries(out).every(([f, txt]) => {
  try { return fs.readFileSync(path.join(OUT, f), "utf8") === txt; } catch { return false; }
});
if (!same) {
  fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
  for (const [f, txt] of Object.entries(out)) {
    const tmp = path.join(OUT, f + "." + process.pid + ".tmp");
    fs.writeFileSync(tmp, txt);
    fs.renameSync(tmp, path.join(OUT, f));
  }
}
console.log(`functions/gen ${same ? "up to date" : "ready"} (roster ${version})`);
