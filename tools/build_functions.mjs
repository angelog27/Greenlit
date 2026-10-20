// Copies the game model (the MODEL section of Frontend/greenlight.html) and data/*.json into functions/gen/,
// so the release Cloud Function scores films with exactly the code the page runs. VERSION is a hash of both
// (the roster version stored with each score). Runs automatically before `firebase deploy` (firebase.json).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "functions", "gen");
const FILES = ["genres", "directors", "actors", "plots", "windows", "loyal", "chem", "slate"];

const html = fs.readFileSync(path.join(ROOT, "Frontend", "greenlight.html"), "utf8");
const a = html.indexOf("// ===== MODEL START ====="), b = html.indexOf("// ===== MODEL END =====");
if (a < 0 || b < 0) throw new Error("model markers not found in Frontend/greenlight.html");
const model = html.slice(a, b);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
fs.writeFileSync(path.join(OUT, "model.js"), model);
const h = crypto.createHash("sha256").update(model);
for (const n of FILES) {
  const txt = fs.readFileSync(path.join(ROOT, "data", n + ".json"), "utf8");
  fs.writeFileSync(path.join(OUT, "data", n + ".json"), txt);
  h.update(txt);
}
const version = h.digest("hex").slice(0, 12);
fs.writeFileSync(path.join(OUT, "VERSION"), version + "\n");
console.log(`functions/gen ready (roster ${version})`);
