// Model-code parity: fed the original data, the current model must behave exactly like the frozen v1 file.
// The live game data (data/*.json) has since grown (new people, new stories, blended genres), so the data
// comes from v1 itself; tests/js/data_and_blends.test.mjs covers the live data.
// Run: node --test tests/js/*.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadModel } from "../../tools/model_loader.mjs";

const root = new URL("../../", import.meta.url);
const ref = loadModel(new URL("reference/greenlight.v1.html", root));
const cur = loadModel(new URL("Frontend/greenlight.html", root));

// vm contexts have their own Array/Object prototypes, so compare through JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));
cur.initModel(plain({
  genres: ref.GENRES, directors: ref.DIRS, actors: ref.ACTORS, plots: ref.PLOTS, windows: ref.WINDOWS,
  loyal: ref.LOYAL.map(([director, actor, bonus, films]) => ({ director, actor, bonus, films })),
  chem: ref.CHEM.map(([a, b, bonus, films]) => ({ a, b, bonus, films })),
  slate: ref.SLATE_RAW.map(([date, title, genre, strength]) => ({ date, title, genre, strength })),
}));
const DIFFS = ["easy", "medium", "hard"];
const DAYS = ["2026-10-17", "2026-10-31", "2026-11-14", "2026-12-24", "2027-01-01", "2027-02-14", "2027-03-03", "2027-04-20", "2027-05-05", "2027-06-01"];

test("constants are unchanged", () => {
  for (const k of ["GENRES", "DIRS", "ACTORS", "PLOTS", "WINDOWS", "LOYAL", "CHEM", "SLATE_RAW", "SLATE", "SEASON", "LAST_DATE", "SHARE", "DIFFS"]) {
    assert.deepEqual(plain(cur[k]), plain(ref[k]), k);
  }
});

// Cast shortlists are drawn differently on purpose since Oct 2026 (one seed per person, so the order of
// actors.json doesn't matter); data_and_blends.test.mjs checks them. The day's market is still identical.
test("daily environment is unchanged", () => {
  for (const day of DAYS) assert.deepEqual(plain(cur.makeEnv(day)), plain(ref.makeEnv(day)), day);
});

test("scoring is unchanged over random picks in every mode", () => {
  const r = ref.rng(12345);
  const pick = (a) => a[Math.floor(r() * a.length)];
  let n = 0;
  for (const day of DAYS) {
    const envR = ref.makeEnv(day), envC = cur.makeEnv(day);
    for (const diff of DIFFS) {
      const cfg = ref.DIFFS[diff];
      for (let i = 0; i < 30; i++) {
        const g = pick(ref.GENRES).id, pools = ref.poolsFor(envR, g);
        const w = cfg.real ? pick(envR.dates) : pick(ref.WINDOWS.filter((x) => !x.hardOnly)).id;
        const p = { g, d: pick(ref.DIRS).id, a1: pick(pools[0]), a2: pick(pools[1]), a3: pick(pools[2]), w };
        const a = ref.evalFilm(envR, p, cfg), b = cur.evalFilm(envC, p, cur.DIFFS[diff]);
        assert.deepEqual(plain(b), plain(a), JSON.stringify({ day, diff, p }));
        n++;
      }
    }
  }
  assert.ok(n >= 900);
});

test("best possible film is unchanged", () => {
  // Same search over the same shortlists: hand the current model v1's pools.
  const own = cur.poolsFor;
  cur.poolsFor = (env, gid) => plain(ref.poolsFor(env, gid));
  after(() => { cur.poolsFor = own; });
  for (const day of DAYS.slice(0, 2)) {
    for (const diff of DIFFS) {
      for (const g of ["horror", "action"]) {
        const a = ref.bestPossible(ref.makeEnv(day), g, ref.DIFFS[diff]);
        const b = cur.bestPossible(cur.makeEnv(day), g, cur.DIFFS[diff]);
        assert.deepEqual(plain(b), plain(a), `${day} ${diff} ${g}`);
      }
    }
  }
});
