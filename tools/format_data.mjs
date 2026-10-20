// Sorts and lays out data/*.json so people are easy to find: one record per line, columns aligned.
//   actors.json     star power (high to low), then fee, then name
//   directors.json  skill (high to low), then fee, then name
//   loyal.json      grouped by director (in directors.json order), biggest bonus first
//   chem.json       grouped by the higher-billed actor (in actors.json order), biggest bonus first
// genres, windows and slate keep their order (the daily seed walks genres and windows in file order; slate is by date)
// and are only laid out one per line. plots.json and images.json are left alone.
// Safe to re-run after adding people: node tools/format_data.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const rd = (n) => JSON.parse(fs.readFileSync(path.join(P, n + ".json"), "utf8"));

const cell = (v) => (Array.isArray(v) ? "[" + v.map((x) => JSON.stringify(x)).join(", ") + "]"
  : v && typeof v === "object" ? "{ " + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ": " + JSON.stringify(x)).join(", ") + " }"
  : JSON.stringify(v));

// One object per line, every field but the last padded so the columns line up. A row missing an optional
// field leaves its column blank, so the fields after it stay in line.
function table(rows, keys) {
  keys = keys || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const last = keys.length - 1, txt = (r, k) => JSON.stringify(k) + ": " + cell(r[k]);
  const w = keys.map((k, i) => (i === last ? 0 : Math.max(0, ...rows.filter((r) => k in r).map((r) => txt(r, k).length + 1))));
  const lines = rows.map((r) => {
    const end = keys.reduce((e, k, i) => (k in r ? i : e), -1);
    const cols = keys.slice(0, end + 1).map((k, i) => (i === end ? txt(r, k) : ((k in r ? txt(r, k) + "," : "").padEnd(w[i]))));
    return "  { " + cols.join(" ") + " }";
  });
  return "[\n" + lines.join(",\n") + "\n]\n";
}
const wr = (n, rows, keys) => fs.writeFileSync(path.join(P, n + ".json"), table(rows, keys));
const byName = (a, b) => a.name.localeCompare(b.name);

const actors = rd("actors").sort((a, b) => b.star - a.star || b.fee - a.fee || byName(a, b));
const directors = rd("directors").sort((a, b) => b.skill - a.skill || b.fee - a.fee || byName(a, b));
const ai = new Map(actors.map((a, i) => [a.id, i])), di = new Map(directors.map((d, i) => [d.id, i]));

const loyal = rd("loyal").sort((x, y) => di.get(x.director) - di.get(y.director) || y.bonus - x.bonus || ai.get(x.actor) - ai.get(y.actor));
// A chemistry pair works either way round, so list it under whichever actor comes first in actors.json.
const chem = rd("chem").map((c) => (ai.get(c.a) <= ai.get(c.b) ? c : { ...c, a: c.b, b: c.a }))
  .sort((x, y) => ai.get(x.a) - ai.get(y.a) || y.bonus - x.bonus || ai.get(x.b) - ai.get(y.b));

wr("actors", actors, ["id", "name", "s", "star", "fee", "g", "tone", "known"]);
wr("directors", directors, ["id", "name", "skill", "fee", "spec", "tone", "note", "known"]);
wr("loyal", loyal, ["director", "actor", "bonus", "films"]);
wr("chem", chem, ["a", "b", "bonus", "films"]);
wr("genres", rd("genres"));
wr("windows", rd("windows"), ["id", "name", "when", "vibe", "cost", "base", "hardOnly", "g"]);
wr("slate", rd("slate"));
console.log(`data formatted: ${actors.length} actors, ${directors.length} directors, ${loyal.length} reunions, ${chem.length} chemistry pairs`);
