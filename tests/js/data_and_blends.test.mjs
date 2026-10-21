// Live game data (data/*.json) is well formed, blended genres behave as designed, and evalFast stays in
// sync with evalFilm (bestPossible depends on it) for every genre including blends.
// Run: node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModel } from "../../tools/model_loader.mjs";

const root = new URL("../../", import.meta.url);
const FILES = ["genres", "directors", "actors", "plots", "windows", "loyal", "chem", "slate"];
const data = Object.fromEntries(FILES.map((n) => [n, JSON.parse(readFileSync(new URL(`data/${n}.json`, root), "utf8"))]));
const m = loadModel(new URL("Frontend/greenlight.html", root));
m.initModel(data);

const TONES = ["gritty", "heartfelt", "funny", "epic", "eerie", "stylish"];
const gids = data.genres.map((g) => g.id);
const plainIds = data.genres.filter((g) => !g.mix).map((g) => g.id);
const winIds = data.windows.filter((w) => !w.hardOnly).map((w) => w.id);
const people = new Set([...data.directors, ...data.actors].map((p) => p.id));
const DAYS = ["2026-10-19", "2026-11-14", "2026-12-24", "2027-02-14", "2027-05-05"];

test("ids are unique and every reference resolves", () => {
  for (const k of ["genres", "directors", "actors"]) {
    const ids = data[k].map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, `${k} ids unique`);
  }
  for (const d of data.directors) for (const g of d.spec) assert.ok(gids.includes(g), `${d.id} spec ${g}`);
  for (const a of data.actors) {
    assert.ok(a.s === "m" || a.s === "f", `${a.id} gender`);
    for (const g of a.g) assert.ok(gids.includes(g), `${a.id} genre ${g}`);
    for (const t of a.tone) assert.ok(TONES.includes(t), `${a.id} tone ${t}`);
  }
  for (const d of data.directors) for (const t of d.tone) assert.ok(TONES.includes(t), `${d.id} tone ${t}`);
  for (const l of data.loyal) assert.ok(people.has(l.director) && people.has(l.actor), `loyal ${l.director}+${l.actor}`);
  for (const c of data.chem) assert.ok(people.has(c.a) && people.has(c.b), `chem ${c.a}+${c.b}`);
  for (const s of data.slate) assert.ok(plainIds.includes(s.genre), `slate ${s.title} genre ${s.genre}`);
  // shortlists need three men and three women for each of three roles
  for (const s of ["m", "f"]) assert.ok(data.actors.filter((a) => a.s === s).length >= 9, `at least 9 actors with s=${s}`);
});

test("every genre has at least six complete pitches", () => {
  for (const g of data.genres) {
    const ps = data.plots[g.id];
    assert.ok(Array.isArray(ps) && ps.length >= 6, `${g.id} has 6+ pitches`);
    for (const p of ps) {
      if (p.from !== undefined) assert.match(p.from, /^\d{4}-\d\d-\d\d$/, `${p.title} from date`);
      assert.ok(p.title && p.text, `${g.id} pitch text`);
      assert.ok(p.tones.length >= 1 && p.tones.every((t) => TONES.includes(t)), `${p.title} tones`);
      assert.ok(p.win.length >= 1 && p.win.every((w) => winIds.includes(w)), `${p.title} windows`);
      for (const r of ["lead", "side", "anta"]) assert.ok(p[r].r && TONES.includes(p[r].t), `${p.title} ${r}`);
    }
  }
  const titles = Object.values(data.plots).flat().map((p) => p.title);
  assert.equal(new Set(titles).size, titles.length, "pitch titles unique");
});

// New pitches carry a `from` date: before it, every day keeps exactly the pitch it had; from it on, all join.
test("pitches with a from date never change an earlier day's puzzle", () => {
  const before = Object.fromEntries(data.genres.map((g) => [g.id, data.plots[g.id].filter((p) => !p.from)]));
  const old = loadModel(new URL("Frontend/greenlight.html", root));
  old.initModel({ ...data, plots: before });
  const firstFrom = Object.values(data.plots).flat().map((p) => p.from).filter(Boolean).sort()[0];
  for (let i = 1; i <= 40; i++) {
    const day = m.addDays(firstFrom, -i);
    assert.deepEqual(JSON.parse(JSON.stringify(m.makeEnv(day))), JSON.parse(JSON.stringify(old.makeEnv(day))), day);
  }
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    const env = m.makeEnv(m.addDays(firstFrom, i));
    for (const g of data.genres) { const p = m.plotFor(env, g.id); assert.ok(!p.from || p.from <= env.day); seen.add(p.title); }
  }
  assert.ok(seen.size > Object.values(before).flat().length, "new pitches show up after their date");
});

test("blends: halves exist, heat is their average, and either half matches", () => {
  const blends = data.genres.filter((g) => g.mix);
  assert.ok(blends.length > 0);
  for (const g of blends) {
    assert.equal(g.mix.length, 2, `${g.id} has two halves`);
    for (const p of g.mix) assert.ok(plainIds.includes(p), `${g.id} half ${p} is a plain genre`);
  }
  for (const day of DAYS) {
    const env = m.makeEnv(day);
    for (const g of blends) assert.equal(env.heat[g.id], Math.round(((env.heat[g.mix[0]] + env.heat[g.mix[1]]) / 2) * 100) / 100, `${day} ${g.id} heat`);
  }
  assert.equal(m.inGenre(["horror"], "horrorcomedy"), true);
  assert.equal(m.inGenre(["comedy"], "horrorcomedy"), true);
  assert.equal(m.inGenre(["drama"], "horrorcomedy"), false);
  assert.equal(m.inGenre(["horror"], "comedy"), false, "plain genres only match themselves");
  const hallow = data.windows.find((w) => w.id === "hallow");
  const avg = ((hallow.g.horror || 1) + (hallow.g.comedy || 1)) / 2;
  assert.equal(m.winG(hallow, "horrorcomedy"), avg, "window fit averages the halves");
});

test("adding blends does not move a day's budget or rival", () => {
  const plainOnly = loadModel(new URL("Frontend/greenlight.html", root));
  plainOnly.initModel({ ...data, genres: data.genres.filter((g) => !g.mix) });
  for (const day of DAYS) {
    const a = m.makeEnv(day), b = plainOnly.makeEnv(day);
    assert.equal(a.budget, b.budget, day);
    assert.equal(a.rival, b.rival, day);
    for (const g of plainIds) assert.equal(a.heat[g], b.heat[g], `${day} ${g}`);
  }
});

test("shortlists: 3 roles x (3 men + 3 women), nobody repeated, for every genre", () => {
  const A = Object.fromEntries(data.actors.map((a) => [a.id, a]));
  for (const day of DAYS) {
    const env = m.makeEnv(day);
    for (const g of gids) {
      const pools = m.poolsFor(env, g);
      assert.equal(pools.length, 3);
      const all = pools.flat();
      assert.equal(new Set(all).size, 18, `${day} ${g} no repeats`);
      for (const p of pools) assert.deepEqual([p.filter((id) => A[id].s === "m").length, p.filter((id) => A[id].s === "f").length], [3, 3]);
    }
  }
});

test("evalFast matches evalFilm for every genre, blends included", () => {
  const r = m.rng(777);
  const pick = (a) => a[Math.floor(r() * a.length)];
  for (const day of DAYS) {
    const env = m.makeEnv(day);
    for (const diff of ["easy", "medium", "hard"]) {
      const cfg = m.DIFFS[diff];
      for (const g of gids) {
        for (let i = 0; i < 4; i++) {
          const pools = m.poolsFor(env, g);
          const p = { g, d: pick(data.directors).id, a1: pick(pools[0]), a2: pick(pools[1]), a3: pick(pools[2]), w: cfg.real ? pick(env.dates) : pick(winIds) };
          const a = m.evalFilm(env, p, cfg), b = m.evalFast(env, p, cfg, {});
          assert.ok(Math.abs(a.profit - b.profit) < 1e-9 && a.cost === b.cost, `${day} ${diff} ${JSON.stringify(p)}`);
        }
      }
    }
  }
});

test("best possible film works for a blend", () => {
  const env = m.makeEnv(DAYS[0]);
  const b = m.bestPossible(env, "horrorcomedy", m.DIFFS.medium);
  assert.ok(b && b.cost <= env.budget && b.p.g === "horrorcomedy");
});

test("shortlists don't depend on the order of actors.json or directors.json", () => {
  const shuffled = loadModel(new URL("Frontend/greenlight.html", root));
  const r = m.rng(4242), mix = (a) => a.map((x) => [r(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  shuffled.initModel({ ...data, actors: mix(data.actors), directors: mix(data.directors).reverse() });
  for (const day of DAYS) {
    const a = m.makeEnv(day), b = shuffled.makeEnv(day);
    for (const g of gids) {
      assert.deepEqual(JSON.parse(JSON.stringify(shuffled.poolsFor(b, g))), JSON.parse(JSON.stringify(m.poolsFor(a, g))), `${day} ${g} cast`);
      assert.deepEqual(JSON.parse(JSON.stringify(shuffled.dirsFor(b, g))), JSON.parse(JSON.stringify(m.dirsFor(a, g))), `${day} ${g} directors`);
    }
  }
});

test("genre-aware talent: specialists keep full skill, off-genre directors and stars count for less (from SKILL_FROM)", () => {
  for (const g of data.genres) for (const n of g.near || []) assert.ok(plainIds.includes(n), `${g.id} near ${n}`);
  const env = m.makeEnv("2026-11-01"), old = m.makeEnv("2026-10-21");
  assert.ok(env.gs && !old.gs, "applies from the cutoff only");
  const peele = m.D.peele, chazelle = m.D.chazelle;
  assert.equal(m.dirSkill(old, peele, "romance"), peele.skill, "before: plain skill");
  assert.ok(m.dirSkill(env, peele, "romance") < m.dirSkill(env, chazelle, "romance"), "Peele is no longer the best romance director");
  assert.equal(m.dirSkill(env, peele, "horror"), peele.skill, "full skill in his own genre");
  assert.equal(m.dirSkill(env, peele, "horrorcomedy"), peele.skill, "either half of a blend counts");
  // In every genre, the best director by effective skill specialises in it or a related genre.
  for (const g of data.genres) {
    const best = data.directors.slice().sort((a, b) => m.dirSkill(env, b, g.id) - m.dirSkill(env, a, g.id))[0];
    assert.ok(m.fitLevel(best.spec, g.id) >= 1, `${g.id}: ${best.id} should fit`);
  }
  const off = m.ACTORS.find((a) => m.fitLevel(a.g, "animation") === 0);
  assert.ok(m.starOf(env, off, "animation") < off.star && m.starOf(old, off, "animation") === off.star);
});
