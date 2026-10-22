// Oct 22 2026 features: the table read (script questions), one shared Daily Challenge plot per day, the daily
// Greenlight Globes rounds (closing 19:30 Chicago time), and the expanded roster's photos and collaborations.
// Run: node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
execFileSync(process.execPath, [fileURLToPath(new URL("tools/build_functions.mjs", root))]);
const require = createRequire(import.meta.url);
const { loadGame, check, Reject, cleanNotes } = require("../../functions/game.js");
const awards = require("../../functions/awards.js");
const game = loadGame(), m = game.m;
const json = (n) => JSON.parse(readFileSync(new URL(`data/${n}.json`, root), "utf8"));

const DAY = "2026-10-23", NOW = Date.parse("2026-10-23T15:00:00Z");
const winIds = m.WINDOWS.filter((w) => !w.hardOnly).map((w) => w.id);
function honest(env, gid, diff) {
  const cfg = m.DIFFS[diff], byFee = (ids, M) => ids.slice().sort((a, b) => M[a].fee - M[b].fee)[0], pools = m.poolsFor(env, gid);
  const w = cfg.real ? env.dates.slice().sort((a, b) => m.W[m.seasonOf(a)].cost - m.W[m.seasonOf(b)].cost)[0] : winIds.slice().sort((a, b) => m.W[a].cost - m.W[b].cost)[0];
  return { g: gid, d: byFee(m.dirsFor(env, gid), m.D), a1: byFee(pools[0], m.A), a2: byFee(pools[1], m.A), a3: byFee(pools[2], m.A), w };
}

test("table read: three seeded options per question, one right answer, from READ_FROM only", () => {
  const env = m.makeEnv(DAY);
  for (const g of m.GENRES.map((x) => x.id)) {
    const q = m.readQuiz(env, g), again = m.readQuiz(m.makeEnv(DAY), g), pl = m.plotFor(env, g);
    assert.equal(q.length, 2);
    q.forEach((x) => { assert.equal(x.opts.length, 3); assert.equal(new Set(x.opts).size, 3); assert.ok(x.ans >= 0 && x.ans < 3); });
    assert.equal(q[0].opts[q[0].ans], pl.tones.slice().sort().join(" and "));
    assert.equal(q[1].opts[q[1].ans], pl.anta.t);
    assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(q)), "same day, same questions");
  }
  assert.equal(m.readOn(m.makeEnv("2026-10-21")), false);
  assert.equal(m.readOn(env), true);
});

test("table read: right answers add a step; the server scores them like the page", () => {
  const env = m.makeEnv(DAY), cfg = m.DIFFS.medium;
  const g = m.GENRES.map((x) => x.id).find((x) => m.costOf(honest(env, x, "medium"), cfg) <= env.budget);
  const p = honest(env, g, "medium"), q = m.readQuiz(env, g);
  const right = { ...p, notes: [q[0].ans, q[1].ans] }, half = { ...p, notes: [q[0].ans, (q[1].ans + 1) % 3] };
  const r0 = m.evalFilm(env, p, cfg), r2 = m.evalFilm(env, right, cfg), r1 = m.evalFilm(env, half, cfg);
  assert.ok(r2.gross > r1.gross && r1.gross > r0.gross);
  assert.ok(r2.steps.some((s) => s.k === "Table read" && s.x === 1.06));
  assert.ok(!r0.steps.some((s) => s.k === "Table read"));
  const fast = m.evalFast(env, right, cfg), fp = typeof fast === "number" ? fast : fast.profit;
  assert.ok(Math.abs(fp - r2.profit) < 1e-6, "evalFast in sync: " + fp + " vs " + r2.profit);
  const out = check(game, { type: "basic", diff: "medium", day: DAY, pick: right }, NOW);
  assert.ok(Math.abs(out.profit - r2.profit) < 1e-9);
  assert.equal(cleanNotes([0, 3]), null); assert.equal(cleanNotes("x"), null); assert.deepEqual(cleanNotes([2, 0]), [2, 0]);
  const junk = check(game, { type: "basic", diff: "medium", day: DAY, pick: { ...p, notes: [9, 9] } }, NOW);
  assert.ok(Math.abs(junk.profit - r0.profit) < 1e-9, "bad notes count as not answered");
});

test("daily challenge: one genre and one plot per day for everyone, rotating by day", () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const day = m.addDays(DAY, i), a = m.makeEnv(day), b = m.makeEnv(day);
    assert.equal(a.daily, b.daily);
    assert.equal(a.plots[a.daily], b.plots[b.daily]);
    seen.add(a.daily + "|" + m.plotFor(a, a.daily).title);
  }
  assert.ok(seen.size > 12, "the daily plot rotates");
  const env = m.makeEnv(DAY), g = env.daily, other = m.plotChoices(DAY, g).find((s) => s !== env.plots[g]);
  if (other !== undefined) assert.throws(() => check(game, { type: "daily", diff: "hard", day: DAY, pick: { ...honest(env, g, "hard"), s: other } }, NOW), (e) => e instanceof Reject);
});

test("free play shuffles: each offer shares no script with the one before; the first skips the day's story", () => {
  for (const day of ["2026-10-23", "2026-10-27"]) for (const g of m.GENRES.map((x) => x.id)) {
    const own = m.makeEnv(day).plots[g], L = m.plotChoices(day, g).length;
    let prev = null;
    for (let n = 0; n < 6; n++) {
      const o = m.basicOffer(day, g, n), ids = o.map((x) => x.s);
      assert.equal(new Set(ids).size, 3);
      assert.equal(o.filter((x) => x.q === m.SCRIPT_Q[0]).length, 1);
      if (n === 0) assert.ok(!ids.includes(own), "first shuffle: new scripts only");
      if (prev && L >= 6) assert.ok(ids.every((s) => !prev.includes(s)), `${day} ${g} offer ${n} repeats a script`);
      prev = ids;
    }
  }
  const old = m.basicOffer("2026-10-22", "action", 1), again = m.scriptOffer("offer|2026-10-22|action|1", m.plotChoices("2026-10-22", "action"));
  assert.deepEqual(JSON.parse(JSON.stringify(old)), JSON.parse(JSON.stringify(again)), "earlier days keep their offers");
});

test("globes: daily rounds close at 7:30 PM Chicago time, through DST", () => {
  const at = (t) => awards.weekOf(Date.parse(t));
  assert.equal(at("2026-10-22T00:29:00Z").id, "2026-10-21");
  assert.equal(at("2026-10-22T00:31:00Z").id, "2026-10-22");
  assert.equal(new Date(at("2026-10-22T00:31:00Z").end).toISOString(), "2026-10-23T00:30:00.000Z");
  assert.equal(new Date(at("2026-11-02T01:29:00Z").end).toISOString(), "2026-11-02T01:30:00.000Z", "CST after the change");
  for (let t = Date.parse("2026-10-20T00:00:00Z"); t < Date.parse("2027-04-01T00:00:00Z"); t += 3 * 3600000 + 17 * 60000) {
    const w = awards.weekOf(t);
    assert.ok(w.start <= t && t < w.end);
    assert.ok(w.end - w.start === 86400000 || Math.abs(w.end - w.start - 86400000) === 3600000);
  }
});

test("roster: every actor and director has a photo; collaborations point at real people", () => {
  const img = json("images"), A = json("actors"), D = json("directors"), ids = new Set(A.map((a) => a.id)), dids = new Set(D.map((d) => d.id));
  A.concat(D).forEach((p) => assert.ok(img.people[p.id] && img.people[p.id].profile, "photo for " + p.id));
  json("loyal").forEach((r) => assert.ok(dids.has(r.director) && ids.has(r.actor), JSON.stringify(r)));
  const pairs = new Set();
  json("chem").forEach((r) => { assert.ok(ids.has(r.a) && ids.has(r.b) && r.a !== r.b); const k = [r.a, r.b].sort().join("|"); assert.ok(!pairs.has(k), "duplicate " + k); pairs.add(k); });
});
