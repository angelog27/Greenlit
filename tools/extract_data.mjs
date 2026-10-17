// One-off: writes data/*.json from the constants in reference/greenlight.v1.html.
// Tuples (LOYAL, CHEM, SLATE_RAW) become named objects; the page converts them back.
import { writeFileSync } from "node:fs";
import { loadModel } from "./model_loader.mjs";

const m = loadModel(new URL("../reference/greenlight.v1.html", import.meta.url));
const out = {
  genres: m.GENRES,
  directors: m.DIRS,
  actors: m.ACTORS,
  plots: m.PLOTS,
  windows: m.WINDOWS,
  loyal: m.LOYAL.map(([director, actor, bonus, films]) => ({ director, actor, bonus, films })),
  chem: m.CHEM.map(([a, b, bonus, films]) => ({ a, b, bonus, films })),
  slate: m.SLATE_RAW.map(([date, title, genre, strength]) => ({ date, title, genre, strength })),
};
for (const [name, v] of Object.entries(out)) {
  writeFileSync(new URL(`../data/${name}.json`, import.meta.url), JSON.stringify(v, null, 2) + "\n");
}
console.log(Object.entries(out).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : Object.keys(v).length}`).join(", "));
