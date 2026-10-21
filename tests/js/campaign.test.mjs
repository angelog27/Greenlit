// Campaign mode (functions/campaign.js + campaign_store.js): unlocks, bank and bailouts, shortlists, the
// feasibility gate, release checks, idempotency, badges, passes, and that a campaign film scores exactly like
// the page's model for the same picks and env. Builds functions/gen from the current page and data first.
// Run: node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadModel } from "../../tools/model_loader.mjs";

const root = new URL("../../", import.meta.url);
execFileSync(process.execPath, [fileURLToPath(new URL("tools/build_functions.mjs", root))]);
const require = createRequire(import.meta.url);
const { loadGame, Reject } = require("../../functions/game.js");
const camp = require("../../functions/campaign.js");
const { makeStore, filmId } = require("../../functions/campaign_store.js");
const game = loadGame();
const C = camp.loadCampaign(game);
const m = game.m, cfg = C.cfg;
const DATE = "2026-10-20", NOW = Date.parse("2026-10-20T12:00:00Z");
const plain = (v) => JSON.parse(JSON.stringify(v));
const rejects = (fn, re) => assert.throws(fn, (e) => e instanceof Reject && re.test(e.message));

// A studio at a given lifetime profit (unlocks follow from it), bank and film count.
function studio(lifetime, { bank = cfg.start.bank, films = 5, index = 7, uid = "u1", perks = {}, proofs } = {}) {
  const st = camp.newCampaign(C, uid, "cid", "", DATE, NOW);
  const u = camp.unlocksFor(C, lifetime);
  Object.assign(st, { lifetimeProfit: lifetime, bank, filmsMade: films, projectIndex: index, perks,
    unlocked: { actorTier: u.actorTier, directorTier: u.directorTier, genres: u.genres, hard: u.hard },
    gates: Object.fromEntries(u.gates.map((g) => [g, NOW])) });
  st.currentProject = camp.makeProject(C, st, uid, DATE, false, proofs);
  return plain(st);
}
// The cheapest legal film for a playable genre of the current project.
function cheapest(st, gid) {
  const pj = st.currentProject, gs = pj.genres[gid], lo = (ids, M) => ids.slice().sort((a, b) => M[a].fee - M[b].fee || (a < b ? -1 : 1))[0];
  const wins = m.DIFFS[pj.diff].real ? pj.env.dates.slice().sort((a, b) => m.W[m.seasonOf(a)].cost - m.W[m.seasonOf(b)].cost)
    : m.WINDOWS.filter((w) => !w.hardOnly).map((w) => w.id).sort((a, b) => m.W[a].cost - m.W[b].cost);
  return { g: gid, d: lo(gs.dirs, m.D), a1: lo(gs.pools.a1, m.A), a2: lo(gs.pools.a2, m.A), a3: lo(gs.pools.a3, m.A), w: wins[0] };
}
// The best film of a playable genre (the feasibility proof), so a release is a guaranteed hit.
function bestFilm(st, gid) {
  const pj = st.currentProject;
  return plain(camp.feasible(C, camp.projectEnv(pj), gid, m.DIFFS[pj.diff]).p);
}
// The env a released film was really scored with: the project's, plus its on-set event and breakout.
function filmEnv(pj, film) {
  const e = plain(camp.projectEnv(pj));
  if (film.event) { e.prod = { [film.genre]: film.event.gross }; e.extra = film.event.cost; }
  if (film.wom) e.wom = { [film.genre]: film.wom };
  if (film.breakout) e.boom = { [film.genre]: film.breakout.x };
  return e;
}
const playable = (st) => Object.keys(st.currentProject.genres).filter((g) => st.currentProject.genres[g].state === "ok");

// Minimal Firestore stand-in: transactions apply their writes at the end, and writes must be plain
// objects of this realm without undefined, as the Admin SDK requires.
function fakeDb() {
  const docs = new Map();
  const check = (v, at) => {
    if (v === undefined) throw new Error("undefined at " + at);
    if (v && typeof v === "object") {
      if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) throw new Error("not a plain object at " + at);
      Object.keys(v).forEach((k) => check(v[k], at + "." + k));
    }
  };
  return {
    docs,
    doc: (path) => ({ path }),
    // Direct children of a collection path, like the Admin SDK's collection(path).get().
    collection: (path) => ({ get: async () => ({ docs: [...docs.entries()].filter(([k]) => k.startsWith(path + "/") && !k.slice(path.length + 1).includes("/")).map(([, v]) => ({ data: () => structuredClone(v) })) }) }),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async (r) => ({ exists: docs.has(r.path), data: () => structuredClone(docs.get(r.path)) }),
        set: (r, v) => { check(v, r.path); writes.push([r.path, structuredClone(v)]); },
      };
      const out = await fn(tx);
      writes.forEach(([p, v]) => docs.set(p, v));
      return out;
    },
  };
}

test("tiers are derived from stats with the configured thresholds", () => {
  for (const a of m.ACTORS) {
    const want = a.star >= 9 ? "A" : a.star >= 8 ? "B" : a.star >= 7 ? "C" : "D";
    assert.equal(C.actorTier[a.id], want, a.id);
  }
  for (const d of m.DIRS) {
    const want = d.skill >= 1.25 ? "A" : d.skill >= 1.2 ? "B" : d.skill >= 1.15 ? "C" : "D";
    assert.equal(C.dirTier[d.id], want, d.id);
  }
});

test("unlocks follow the ladder and never depend on anything but lifetime profit", () => {
  const at = (x) => camp.unlocksFor(C, x);
  assert.deepEqual(plain(at(0)), { actorTier: "D", directorTier: "D", genres: ["comedy", "horror", "drama", "horrorcomedy"], hard: false, gates: ["open"] });
  assert.equal(at(cfg.ladder[1].at - 0.1).actorTier, "D");
  assert.equal(at(cfg.ladder[1].at).actorTier, "C");
  assert.equal(at(cfg.ladder[1].at).directorTier, "D");
  const c = at(cfg.ladder[2].at);
  assert.equal(c.directorTier, "C");
  assert.ok(c.genres.includes("thriller") && c.genres.includes("romance"));
  const b = at(cfg.ladder[3].at);
  assert.equal(b.actorTier + b.directorTier, "BB");
  assert.ok(b.genres.includes("action") && b.genres.includes("scifi") && !b.genres.includes("animation"));
  const a = at(cfg.ladder[4].at);
  assert.equal(a.actorTier + a.directorTier, "AA");
  assert.ok(a.hard && a.genres.includes("animation"));
  assert.equal(a.genres.length, m.GENRES.length);
});

test("budget is the bank clamped between the floor and the top unlocked tier's cap", () => {
  const st = (life, bank) => ({ bank, unlocked: camp.unlocksFor(C, life) });
  assert.equal(camp.budgetFor(C, st(0, 1000)), cfg.caps.D);
  assert.equal(camp.budgetFor(C, st(0, 10)), cfg.start.floor);
  assert.equal(camp.budgetFor(C, st(cfg.ladder[1].at, 1000)), cfg.caps.C); // C actors lift the cap
  assert.equal(camp.budgetFor(C, st(cfg.ladder[4].at, 1000)), cfg.caps.A);
  assert.equal(camp.budgetFor(C, st(cfg.ladder[4].at, 100)), Math.min(100, cfg.caps.A));
});

test("bailout: below the floor the bank resets to the floor and is counted", () => {
  assert.deepEqual(camp.settle(C, cfg.start.floor - 0.1), { bank: cfg.start.floor, bailout: true });
  assert.deepEqual(camp.settle(C, cfg.start.floor), { bank: cfg.start.floor, bailout: false });
  assert.deepEqual(camp.settle(C, 123.456), { bank: 123.5, bailout: false });
  // A real flop: the dearest film of the cheapest D-tier genre, forced to lose by stubbing luck is not
  // allowed, so find a losing film on some project instead.
  let st = studio(0, { bank: cfg.start.floor }), flop = null;
  for (let i = 0; i < 40 && !flop; i++) {
    st = studio(0, { bank: cfg.start.floor, index: i });
    for (const g of playable(st)) {
      const p = cheapest(st, g), o = camp.release(C, st, "u1", { index: st.currentProject.index, pick: p }, DATE, NOW);
      if (o.film.profit < 0) { flop = { st, p }; break; }
    }
  }
  assert.ok(flop, "found a flop to test with");
  const out = camp.release(C, flop.st, "u1", { index: flop.st.currentProject.index, pick: flop.p }, DATE, NOW);
  assert.ok(out.film.profit < 0);
  assert.equal(out.state.bank, cfg.start.floor);
  assert.equal(out.state.bailouts, flop.st.bailouts + 1);
  assert.equal(out.events.bailout, true);
  assert.equal(out.state.lifetimeProfit, flop.st.lifetimeProfit, "a flop never lowers lifetime profit");
});

const STAGES = cfg.ladder.map((s) => s.at);

test("shortlists: 3 men + 3 women per role, nobody twice, unlocked tiers only (loans from the next tier up)", () => {
  for (const life of STAGES) {
    const u = camp.unlocksFor(C, life);
    for (let i = 0; i < 25; i++) {
      const key = camp.projectKey("u" + i, "cid", i, 0);
      for (const g of u.genres) {
        const { pools, loans } = camp.castPools(C, key, g, u.actorTier);
        const all = pools.flat();
        assert.equal(all.length, 18);
        assert.equal(new Set(all).size, 18, "no repeats across roles");
        for (const p of pools) {
          assert.equal(p.filter((id) => m.A[id].s === "m").length, 3);
          assert.equal(p.filter((id) => m.A[id].s === "f").length, 3);
          const fresh = p.filter((id) => C.actorTier[id] === u.actorTier && !loans.includes(id)).length;
          const supply = m.ACTORS.filter((a) => C.actorTier[a.id] === u.actorTier).length;
          if (supply >= 6) assert.ok(fresh >= cfg.shortlist.freshPerRole, `${life} ${g}: ${fresh} from tier ${u.actorTier}`);
        }
        for (const id of all) {
          const r = C.rank(C.actorTier[id]), cap = C.rank(u.actorTier);
          if (loans.includes(id)) assert.equal(r, cap + 1, `${id} loaned from the next tier`);
          else assert.ok(r <= cap, `${id} tier ${C.actorTier[id]} above ${u.actorTier}`);
        }
        assert.deepEqual(plain(camp.castPools(C, key, g, u.actorTier)), plain({ pools, loans }), "deterministic");
        const ds = camp.crewList(C, key, g, u.directorTier);
        assert.equal(new Set(ds).size, ds.length);
        assert.ok(ds.length <= cfg.shortlist.directors);
        ds.forEach((id) => assert.ok(C.rank(C.dirTier[id]) <= C.rank(u.directorTier), `${id} director tier`));
        const freshD = m.DIRS.filter((d) => C.dirTier[d.id] === u.directorTier).length;
        assert.ok(ds.filter((id) => C.dirTier[id] === u.directorTier).length >= Math.min(cfg.shortlist.freshDirectors, freshD));
      }
    }
  }
});

test("loans only appear where a tier is short, and only for the short gender", () => {
  for (const life of STAGES) {
    const u = camp.unlocksFor(C, life), cap = C.rank(u.actorTier);
    const have = (s) => m.ACTORS.filter((a) => a.s === s && C.rank(C.actorTier[a.id]) <= cap).length;
    const { loans } = camp.castPools(C, "k", u.genres[0], u.actorTier);
    for (const s of ["m", "f"]) assert.equal(loans.filter((id) => m.A[id].s === s).length, Math.max(0, 9 - have(s)), `${u.actorTier} ${s}`);
  }
});

test("feasibility: 200 projects, every playable genre has a film within budget clearing the margin", () => {
  let n = 0, pricey = 0;
  for (let i = 0; i < 200; i++) {
    const life = STAGES[i % STAGES.length];
    const proofs = {}, st = studio(life, { index: i, uid: "sim" + (i % 7), films: i % 6, bank: cfg.start.floor + (i * 13) % 90, proofs });
    const pj = st.currentProject, env = camp.projectEnv(pj), dcfg = m.DIFFS[pj.diff];
    const ok = playable(st);
    assert.ok(ok.length >= 1, `project ${i} has a playable genre`);
    for (const g of st.unlocked.genres) {
      if (pj.genres[g].state !== "ok") { pricey++; assert.equal(pj.genres[g].state, "pricey"); continue; }
      const proof = proofs[g];
      const r = m.evalFilm(env, proof.p, dcfg);
      assert.ok(m.costOf(proof.p, dcfg) <= pj.budget, "within budget");
      assert.ok(r.profit >= cfg.feasibility.margin, `${g} clears the margin (${r.profit})`);
      assert.ok(pj.genres[g].dirs.includes(proof.p.d) && pj.genres[g].pools.a1.includes(proof.p.a1));
      n++;
    }
    for (const g of Object.keys(pj.genres)) if (!st.unlocked.genres.includes(g)) assert.equal(pj.genres[g].state, "locked");
  }
  console.log(`  feasibility: ${n} playable genre-projects checked, ${pricey} shown as too pricey`);
});

test("projects are deterministic and differ by uid, campaign and index", () => {
  const st = studio(0);
  const again = plain(camp.makeProject(C, st, "u1", DATE, false));
  assert.deepEqual(again, st.currentProject);
  const other = plain(camp.makeProject(C, { ...st, projectIndex: st.projectIndex + 1 }, "u1", DATE, false));
  assert.notDeepEqual(other.env.heat, st.currentProject.env.heat);
  const otherUser = plain(camp.makeProject(C, st, "u2", DATE, false));
  assert.notEqual(otherUser.key, st.currentProject.key);
});

test("visibility: Easy for the first training films, then Medium; Hard only once unlocked", () => {
  assert.equal(studio(0, { films: 0 }).currentProject.diff, "easy");
  assert.equal(studio(0, { films: cfg.trainingFilms - 1 }).currentProject.diff, "easy");
  assert.equal(studio(0, { films: cfg.trainingFilms }).currentProject.diff, "medium");
  const low = studio(cfg.ladder[3].at);
  rejects(() => camp.setHard(C, low, "u1", { index: low.currentProject.index, hard: true }, DATE), /unlock/);
});

test("a campaign film scores exactly like the page's own model for the same picks and env", () => {
  const page = loadModel(new URL("Frontend/greenlight.html", root));
  page.initModel(plain({ genres: m.GENRES, directors: m.DIRS, actors: m.ACTORS, plots: m.PLOTS, windows: m.WINDOWS,
    loyal: m.LOYAL.map(([director, actor, bonus, films]) => ({ director, actor, bonus, films })), chem: m.CHEM.map(([a, b, bonus, films]) => ({ a, b, bonus, films })),
    slate: m.SLATE_RAW.map(([date, title, genre, strength]) => ({ date, title, genre, strength })) }));
  let n = 0;
  for (const life of STAGES) {
    for (const perks of [{}, { horror: 0.03, comedy: 0.03, drama: 0.03 }]) {
      const st = studio(life, { perks, index: n });
      for (const g of playable(st)) {
        const p = cheapest(st, g), pj = st.currentProject;
        const out = camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW);
        const want = page.evalFilm(filmEnv(pj, out.film), p, page.DIFFS[pj.diff]); // the server's event and spin, replayed
        assert.equal(out.film.profit, Math.round(want.profit * 10) / 10);
        assert.equal(out.film.gross, Math.round(want.gross));
        assert.equal(out.film.cost, want.cost);
        if (perks[g]) assert.ok(want.steps.some((s) => s.k === "Genre Master"), "Genre Master step applied");
        n++;
      }
    }
  }
  assert.ok(n >= 10);
});

test("release rejects anything off the project", () => {
  const st = studio(0), pj = st.currentProject, g = playable(st)[0], p = cheapest(st, g), idx = pj.index;
  const rel = (pick, index = idx) => camp.release(C, st, "u1", { index, pick }, DATE, NOW);
  rejects(() => rel(p, idx + 1), /no longer current/);
  rejects(() => rel(p, null), /no longer current/);
  rejects(() => rel({ ...p, g: "action" }), /hasn't unlocked/);
  rejects(() => rel({ ...p, g: "__proto__" }), /Unknown genre/);
  rejects(() => rel({ ...p, d: "spielberg" }), /director/);
  rejects(() => rel({ ...p, a1: pj.genres[g].pools.a2[0] }), /cast/);
  rejects(() => rel({ ...p, a3: m.ACTORS.find((a) => C.actorTier[a.id] === "A").id }), /cast/);
  rejects(() => rel({ ...p, w: "winter" }), /release slot/);
  rejects(() => rel(null), /No film/);
  const gs = pj.genres[g], dear = (ids, M) => ids.slice().sort((a, b) => M[b].fee - M[a].fee)[0];
  const pricey = { ...p, d: dear(gs.dirs, m.D), a1: dear(gs.pools.a1, m.A), a2: dear(gs.pools.a2, m.A), a3: dear(gs.pools.a3, m.A), w: "summer" };
  if (m.costOf(pricey, m.DIFFS[pj.diff]) > pj.budget) rejects(() => rel(pricey), /over this project's budget/);
});

test("release is idempotent and advances the project exactly once (store transaction)", async () => {
  const db = fakeDb(), store = makeStore(db, C);
  const s0 = (await store.start("u9", { studioName: "  Night  Owl <b>" }, NOW)).state;
  assert.equal(s0.studioName, "Night Owl b");
  assert.equal((await store.start("u9", {}, NOW)).created, false, "start is idempotent too");
  const g = playable(s0)[0], pick = cheapest(s0, g), index = s0.currentProject.index;
  const a = await store.release("u9", { index, pick }, NOW);
  assert.equal(a.replay, false);
  assert.equal(a.state.filmsMade, 1);
  assert.equal(a.state.currentProject.index, index + 1);
  const b = await store.release("u9", { index, pick }, NOW + 1000);
  assert.equal(b.replay, true);
  assert.deepEqual(b.film, { ...a.film, events: a.events });
  assert.equal(b.state.filmsMade, 1, "no second film");
  assert.equal(b.state.bank, a.state.bank, "bank moved once");
  assert.ok(db.docs.has(`campaigns/u9/films/${filmId(index)}`));
  assert.equal([...db.docs.keys()].filter((k) => k.startsWith("campaigns/u9/films/")).length, 1);
  await assert.rejects(store.release("u9", { index: index + 5, pick }, NOW), /no longer current/);
  await assert.rejects(store.release("nobody", { index: 0, pick }, NOW), /Start your studio/);
});

test("passes: cost the fee, skip to the next index, earned every few films, capped", async () => {
  const db = fakeDb(), store = makeStore(db, C);
  let st = (await store.start("p1", {}, NOW)).state;
  assert.equal(st.passesAvailable, cfg.pass.start);
  const out = await store.pass("p1", { index: st.currentProject.index }, NOW);
  assert.equal(out.state.passesAvailable, cfg.pass.start - 1);
  assert.equal(out.state.currentProject.index, st.currentProject.index + 1);
  assert.equal(out.state.bank, Math.max(cfg.start.floor, st.bank - cfg.pass.fee));
  assert.equal(out.events.bailout, st.bank - cfg.pass.fee < cfg.start.floor);
  assert.notEqual(out.state.currentProject.key, st.currentProject.key, "new pitches");
  await assert.rejects(store.pass("p1", { index: out.state.currentProject.index }, NOW), /No passes left/);
  st = out.state;
  for (let i = 0; i < cfg.pass.every * (cfg.pass.cap + 1); i++) {
    const g = playable(st)[0];
    st = (await store.release("p1", { index: st.currentProject.index, pick: cheapest(st, g) }, NOW)).state;
    assert.equal(st.passesAvailable, Math.min(cfg.pass.cap, Math.floor(st.filmsMade / cfg.pass.every)));
  }
});

test("badges and gates: first hit, genre master perk, comeback, unlock events and the board row", () => {
  let st = studio(0, { films: 0, index: 0 }), seen = new Set(), perkGenre = null;
  const events = [];
  for (let i = 0; i < 12; i++) {
    // Keep making films in the genre with the most hits so far, so one reaches Genre Master.
    const g = playable(st).sort((x, y) => (st.genreHits[y] || 0) - (st.genreHits[x] || 0) || (x < y ? -1 : 1))[0];
    const out = camp.release(C, st, "u1", { index: st.currentProject.index, pick: bestFilm(st, g) }, DATE, NOW + i);
    out.film.badges.forEach((b) => { const k = b.id + ":" + b.tier; assert.ok(!seen.has(k), "a badge tier is earned once"); seen.add(k); });
    events.push(out.events);
    if (out.events.perks.length && !perkGenre) perkGenre = out.events.perks[0];
    st = plain(out.state);
  }
  assert.ok(seen.has("first_hit:1"));
  assert.equal(perkGenre, null, "mastery is never automatic");
  assert.deepEqual(st.perks, {});
  assert.ok(Object.values(st.badges).every((x) => x.tier >= 1 && typeof x.at === "number"), "badges carry a tier and a timestamp");
  assert.ok(st.stats.streak >= 1 && st.stats.seasons.length >= 1, "running stats are kept");
  assert.ok(events.some((e) => e.gates.length), "an unlock fired");

  // Single rules, checked on the badge values directly.
  const before = camp.normalize({ ...studio(0), lastProfit: -3, badges: {}, perks: {} });
  const env = camp.projectEnv(before.currentProject), B = C.badges;
  const film = (over = {}) => {
    const f = { p: { g: "horror", d: "gluck", a1: "x", a2: "y", a3: "z", w: "hallow" }, cfg: m.DIFFS.easy, r: { cost: 50 }, profit: 4, budget: 100, ...over };
    return { ...f, facts: camp.filmFacts(C, over.before || before, { p: f.p, cfg: f.cfg, env, profit: f.profit }) };
  };
  const tier = (id, f, st = before, from = before) => camp.tierFor(B[id], camp.badgeValue(C, id, from, st, f));
  assert.equal(tier("comeback", film()), 1);
  assert.equal(tier("comeback", film({ before: { ...before, lastProfit: 2 } })), 0);
  assert.equal(tier("comeback", film({ profit: -1 })), 0);
  const loyal = m.LOYAL[0];
  assert.equal(film({ p: { g: "horror", d: loyal[0], a1: "x", a2: loyal[1], a3: "z", w: "hallow" } }).facts.reunion, true);
  const plot = m.plotFor(env, "horror");
  assert.equal(film({ p: { g: "horror", d: "gluck", a1: "x", a2: "y", a3: "z", w: plot.win[0] } }).facts.timing, true);
  assert.equal(tier("sleeper_hit", film({ profit: 16, r: { cost: 60 } })), 1);
  assert.equal(tier("sleeper_hit", film({ profit: 16, r: { cost: 61 } })), 0);
  assert.deepEqual([99, 100, 200, 350].map((x) => tier("blockbuster", film({ profit: x }))), [0, 1, 2, 3]);
  assert.equal(tier("phoenix", film({ before: { ...before, stats: { ...before.stats, bailedOut: true } } })), 1);
  assert.equal(tier("phoenix", film()), 0);
  const dd = m.DIRS.find((d) => C.dirTier[d.id] === "D").id, da = m.ACTORS.filter((a) => C.actorTier[a.id] === "D").map((a) => a.id);
  const fh = film({ p: { g: "horror", d: dd, a1: da[0], a2: da[1], a3: da[2], w: "hallow" } });
  assert.equal(tier("full_house", fh), 0, "not before C-list actors unlock");
  const later = { ...before, unlocked: camp.unlocksFor(C, cfg.ladder[1].at) };
  assert.equal(tier("full_house", fh, later, later), 1);
  // Tiered studio badges: Fast Track counts down (fewer films is better).
  const ft = B.fast_track;
  assert.deepEqual([null, ft.tiers[0] + 1, ft.tiers[0], ft.tiers[2]].map((v) => camp.tierFor(ft, v)), [0, 0, 1, 3]);
  assert.equal(tier("iron_studio", null, { ...before, aTierFilms: 14, bailouts: 0 }), 1);
  assert.equal(tier("iron_studio", null, { ...before, aTierFilms: 14, bailouts: 1 }), 0);
  assert.equal(tier("box_office", null, { ...before, lifetimeGross: B.box_office.tiers[1] }), 2);
  assert.equal(tier("first_hit", null), 0, "film badges need a film");

  // Reaching the board goal writes the board row once.
  const near = studio(cfg.ladder[4].at - 0.1, { films: 20, bank: 120 });
  const g = playable(near)[0], out = camp.release(C, near, "u1", { index: near.currentProject.index, pick: bestFilm(near, g) }, DATE, NOW);
  assert.ok(out.events.gates.some((x) => x.id === cfg.boardGoal));
  assert.deepEqual(plain(out.board), { displayName: near.studioName, filmsToATier: 21, bailouts: near.bailouts, lifetimeProfit: out.state.lifetimeProfit, reachedAt: NOW, logo: null, color: null });
  assert.equal(out.state.aTierFilms, 21);
});

test("rename: once, cleaned, 2 to 30 characters", async () => {
  const db = fakeDb(), store = makeStore(db, C);
  const s = (await store.start("r1", {}, NOW)).state;
  assert.equal(s.studioName, camp.defaultName("r1"));
  await assert.rejects(store.rename("r1", { name: " " }), /2 to 30/);
  assert.equal((await store.rename("r1", { name: "Paper Moon Pictures" })).state.studioName, "Paper Moon Pictures");
  await assert.rejects(store.rename("r1", { name: "Again" }), /already been renamed/);
});

// ---- levels and upgrades
test("levels come from lifetime box office; each level after the first is one upgrade point", () => {
  const L = cfg.levels;
  assert.equal(camp.levelFor(C, 0), 1);
  assert.equal(camp.levelFor(C, L[1] - 1), 1);
  assert.equal(camp.levelFor(C, L[1]), 2);
  assert.equal(camp.levelFor(C, L[L.length - 1] * 10), L.length);
  const st = { lifetimeGross: L[3], upgrades: {} };
  assert.equal(camp.pointsLeft(C, st), 3);
  assert.equal(camp.pointsLeft(C, { ...st, upgrades: { scout: 2 } }), 1);
  const total = cfg.upgrades.reduce((s, u) => s + u.cost * u.ranks.length, 0);
  assert.ok(L.length - 1 >= total, `the last level pays for every upgrade (${L.length - 1} points, ${total} needed)`);
});

test("upgrades: bought with points, rank by rank, with level gates and caps", () => {
  const base = studio(0);
  rejects(() => camp.upgrade(C, base, "u1", { id: "scout" }), /Not enough upgrade points/);
  rejects(() => camp.upgrade(C, base, "u1", { id: "teleport" }), /Unknown upgrade/);
  rejects(() => camp.upgrade(C, base, "u1", { id: "__proto__" }), /Unknown upgrade/);
  let st = { ...base, lifetimeGross: cfg.levels[cfg.levels.length - 1] };
  const ranks = cfg.upgrades.find((u) => u.id === "scout").ranks.length;
  for (let i = 1; i <= ranks; i++) { st = camp.upgrade(C, st, "u1", { id: "scout" }).state; assert.equal(st.upgrades.scout, i); }
  rejects(() => camp.upgrade(C, st, "u1", { id: "scout" }), /maxed out/);
  const sc = cfg.upgrades.find((u) => u.id === "screenings");
  const low = { ...base, lifetimeGross: cfg.levels[sc.minLevel - 2] + 1 };
  if (camp.pointsLeft(C, low) >= sc.cost) rejects(() => camp.upgrade(C, low, "u1", { id: "screenings" }), /needs studio level/);
  assert.equal(camp.upgrade(C, { ...base, lifetimeGross: cfg.levels[sc.minLevel - 1] }, "u1", { id: "screenings" }).state.upgrades.screenings, 1);
  // Buying ranks earns Well Equipped.
  let eq = { ...base, lifetimeGross: cfg.levels[cfg.levels.length - 1] }, got = [];
  for (const id of ["scout", "scout", "casting"]) { const o = camp.upgrade(C, eq, "u1", { id }, NOW); eq = o.state; got = got.concat(o.badges); }
  assert.deepEqual(got.filter((b) => b.id === "well_equipped").map((b) => ({ id: b.id, tier: b.tier })), [{ id: "well_equipped", tier: 1 }]);
  assert.equal(got.find((b) => b.id === "well_equipped").reward, C.ach.rewards.tiers[0], "a badge tier pays its reward");
});

test("Reputation and Marketing Deals discount the current project's costs through the model", () => {
  let st = { ...studio(0, { index: 3 }), lifetimeGross: cfg.levels[6] };
  const pj0 = st.currentProject;
  st = plain(camp.upgrade(C, st, "u1", { id: "reputation" }).state);
  st = plain(camp.upgrade(C, st, "u1", { id: "marketing" }).state);
  const pj = st.currentProject, rep = cfg.upgrades.find((u) => u.id === "reputation"), mk = cfg.upgrades.find((u) => u.id === "marketing");
  assert.equal(pj.key, pj0.key, "same project, same seed");
  assert.deepEqual(pj.env.plots, pj0.env.plots, "same pitches");
  assert.deepEqual(pj.env.disc, { talent: rep.talent[0], windows: mk.windows[0] });
  const g = playable(st)[0], p = cheapest(st, g), dcfg = m.DIFFS[pj.diff], env = camp.projectEnv(pj);
  const full = m.costOf(p, dcfg), cut = m.costOf(p, dcfg, env);
  const want = m.G[g].cost + [p.d].map((id) => Math.round(m.D[id].fee * (1 - rep.talent[0])))[0] +
    [p.a1, p.a2, p.a3].reduce((s, id) => s + Math.round(m.A[id].fee * (1 - rep.talent[0])), 0) + Math.round(m.W[p.w].cost * (1 - mk.windows[0]));
  assert.equal(cut, want);
  assert.ok(cut < full, `discounted ${cut} < listed ${full}`);
  const out = camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW);
  assert.equal(out.film.cost, cut, "the server charges the discounted cost");
  assert.deepEqual(out.state.currentProject.env.disc, pj.env.disc, "discounts carry to the next project");
  // Daily envs never get a discount.
  assert.equal(m.costOf(p, dcfg, m.makeEnv(DATE)), full);
});

test("release adds the gross to experience and reports level-ups; old studios get the new fields", () => {
  const st = { ...studio(0, { films: 0 }), lifetimeGross: cfg.levels[1] - 1 };
  const g = playable(st)[0], out = camp.release(C, st, "u1", { index: st.currentProject.index, pick: bestFilm(st, g) }, DATE, NOW);
  assert.ok(Math.abs(out.state.lifetimeGross - (st.lifetimeGross + out.film.gross)) <= 1, "gross added (rounding aside)");
  assert.ok(out.events.level && out.events.level.from === 1 && out.events.level.to >= 2);
  assert.equal(out.events.level.points, camp.pointsLeft(C, out.state));
  const old = studio(0);
  delete old.lifetimeGross; delete old.upgrades; delete old.stats; delete old.profile;
  old.badges = { first_hit: 123 };
  const n = camp.normalize(old);
  assert.equal(n.lifetimeGross, 0);
  assert.deepEqual(n.upgrades, {});
  assert.deepEqual(n.badges, { first_hit: { tier: 1, at: 123 } }, "old timestamp badges become tier 1");
  assert.equal(n.stats.streak, 0);
  assert.ok(camp.release(C, old, "u1", { index: old.currentProject.index, pick: cheapest(old, playable(old)[0]) }, DATE, NOW).state.lifetimeGross > 0);
});

test("discounted campaign films score exactly like the page's model", () => {
  const page = loadModel(new URL("Frontend/greenlight.html", root));
  page.initModel(plain({ genres: m.GENRES, directors: m.DIRS, actors: m.ACTORS, plots: m.PLOTS, windows: m.WINDOWS,
    loyal: m.LOYAL.map(([director, actor, bonus, films]) => ({ director, actor, bonus, films })), chem: m.CHEM.map(([a, b, bonus, films]) => ({ a, b, bonus, films })),
    slate: m.SLATE_RAW.map(([date, title, genre, strength]) => ({ date, title, genre, strength })) }));
  let st = { ...studio(cfg.ladder[2].at, { index: 9 }), lifetimeGross: cfg.levels[8] };
  for (const id of ["reputation", "reputation", "marketing"]) st = plain(camp.upgrade(C, st, "u1", { id }).state);
  for (const g of playable(st)) {
    const p = bestFilm(st, g), pj = st.currentProject;
    const out = camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW);
    const want = page.evalFilm(filmEnv(pj, out.film), p, page.DIFFS[pj.diff]);
    assert.equal(out.film.profit, Math.round(want.profit * 10) / 10);
    assert.equal(out.film.cost, want.cost);
  }
});

// ---- studio look
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0, 0, 0, 0];
function fakeFiles(objects) {
  return { removed: [], async meta(path) { return objects[path] || null; }, async head(path) { return Uint8Array.from((objects[path] || {}).bytes || PNG); },
    async remove(path) { this.removed.push(path); delete objects[path]; } };
}

test("studio style: palette colour, cleaned tagline and city, images checked in Storage", async () => {
  const objects = {}, files = fakeFiles(objects), db = fakeDb(), store = makeStore(db, C, files);
  await store.start("s1", {}, NOW);
  const P = cfg.profile;
  let st = (await store.style("s1", { color: "violet", tagline: "  Small budgets,\n big   screams <script> " + "x".repeat(200), city: "Lisbon" }, NOW)).state;
  assert.equal(st.profile.color, "violet");
  assert.ok(st.profile.tagline.startsWith("Small budgets, big screams script"));
  assert.equal(st.profile.tagline.length, P.taglineMax);
  assert.equal(st.profile.city, "Lisbon");
  await assert.rejects(store.style("s1", { color: "#ff0000" }, NOW), /Unknown studio colour/);
  await assert.rejects(store.style("s1", { logo: true }, NOW), /didn't finish uploading/);
  objects["studios/s1/logo"] = { contentType: "image/gif", size: 1000, generation: "1" };
  await assert.rejects(store.style("s1", { logo: true }, NOW), /JPEG, PNG or WebP/);
  objects["studios/s1/logo"] = { contentType: "image/png", size: P.logoKB * 1024 + 1, generation: "2" };
  await assert.rejects(store.style("s1", { logo: true }, NOW), /too big/);
  objects["studios/s1/logo"] = { contentType: "image/png", size: 5000, generation: "2b", bytes: [...Buffer.from("<html><script>alert(1)</script></html>")] };
  await assert.rejects(store.style("s1", { logo: true }, NOW), /isn't a real image/);
  assert.ok(!objects["studios/s1/logo"] && files.removed.includes("studios/s1/logo"), "a fake image is deleted");
  objects["studios/s1/logo"] = { contentType: "image/webp", size: 50000, generation: "3" };
  objects["studios/s1/backdrop"] = { contentType: "image/jpeg", size: 900000, generation: "4" };
  st = (await store.style("s1", { logo: true, backdrop: true }, NOW)).state;
  assert.deepEqual([st.profile.logo, st.profile.backdrop], ["3", "4"]);
  st = (await store.style("s1", { backdrop: false }, NOW)).state;
  assert.equal(st.profile.backdrop, null);
  assert.deepEqual(files.removed, ["studios/s1/logo", "studios/s1/backdrop"]);
  assert.equal(st.profile.logo, "3", "untouched fields stay");
  assert.equal(st.profile.color, "violet");
});

test("studio style reaches the campaign board row once the studio is on it", async () => {
  const objects = { "studios/s2/logo": { contentType: "image/png", size: 1000, generation: "9" } };
  const db = fakeDb(), store = makeStore(db, C, fakeFiles(objects));
  const st = (await store.start("s2", {}, NOW)).state;
  db.docs.set("campaigns/s2", { ...st, aTierFilms: 15 });
  db.docs.set("campaignBoard/s2", { displayName: st.studioName, filmsToATier: 15, bailouts: 0, lifetimeProfit: 2100, reachedAt: NOW, logo: null, color: null });
  await store.style("s2", { color: "teal", logo: true }, NOW);
  const row = db.docs.get("campaignBoard/s2");
  assert.equal(row.color, "teal");
  assert.equal(row.logo, "9");
  assert.equal(row.filmsToATier, 15);
});

test("story rerolls: three scripts per reroll, one strongest, pick one; unlocked by level, a few per project", () => {
  const R = cfg.rerolls, st0 = studio(0, { index: 4 });
  rejects(() => camp.reroll(C, st0, "u1", { index: st0.currentProject.index, g: playable(st0)[0] }), /unlock at studio level/);
  let st = { ...st0, lifetimeGross: cfg.levels[R[0].level - 1] };
  assert.equal(camp.rerollsFor(C, st), R[0].count);
  assert.equal(camp.rerollsFor(C, { ...st, lifetimeGross: cfg.levels[R[1].level - 1] }), R[1].count);
  const g = playable(st)[0], idx = st.currentProject.index;
  rejects(() => camp.reroll(C, st, "u1", { index: idx, g: "action" }), /playable genre/);
  rejects(() => camp.pickScript(C, st, "u1", { index: idx, g, s: 0 }), /no script offer/);
  const a = plain(camp.reroll(C, st, "u1", { index: idx, g }));
  const offer = a.currentProject.offer;
  assert.equal(offer.g, g);
  assert.equal(offer.items.length, Math.min(3, m.plotChoices(a.currentProject.date, g).length));
  assert.equal(offer.items.filter((x) => x.q === m.SCRIPT_Q[0]).length, 1, "exactly one strongest draft");
  assert.equal(a.currentProject.rerolls, 1);
  assert.deepEqual(a.currentProject.env.plots, st.currentProject.env.plots, "nothing changes until a script is picked");
  assert.deepEqual(plain(camp.reroll(C, st, "u1", { index: idx, g })), a, "seeded: same reroll, same offer");
  rejects(() => camp.pickScript(C, a, "u1", { index: idx, g, s: 999 }), /isn't one you can pick/);
  rejects(() => camp.pickScript(C, a, "u1", { index: idx, g: "drama", s: offer.items[0].s }), /no script offer/);
  // Pick the strongest draft: it becomes the project's story with its potential, and the film is scored with it.
  const best = offer.items.find((x) => x.q === m.SCRIPT_Q[0] && x.ok) || offer.items.find((x) => x.ok);
  const b = plain(camp.pickScript(C, a, "u1", { index: idx, g, s: best.s }));
  assert.equal(b.currentProject.env.plots[g], best.s);
  assert.equal(b.currentProject.env.quality[g], best.q);
  assert.equal(b.currentProject.offer, null, "the offer is used up");
  const env = camp.projectEnv(b.currentProject);
  assert.equal(m.scriptQ(env, g), best.q);
  const p = bestFilm(b, g), out = camp.release(C, b, "u1", { index: idx, pick: p }, DATE, NOW);
  assert.equal(out.film.title, m.PLOTS[g][best.s].title);
  assert.equal(out.film.script.q, best.q);
  assert.equal(out.film.script.items.length, offer.items.length, "the film remembers the drafts it was chosen from");
  assert.ok(!out.state.currentProject.rerolls && !out.state.currentProject.env.quality, "a new project starts fresh");
  st = a;
  for (let i = 1; i < R[0].count; i++) st = plain(camp.reroll(C, st, "u1", { index: idx, g }));
  rejects(() => camp.reroll(C, st, "u1", { index: idx, g }), /No story rerolls left/);
});

test("public studio card: written on every change, shows the biggest film, never the bank or the project", async () => {
  const objects = {}, db = fakeDb(), store = makeStore(db, C, fakeFiles(objects));
  let st = (await store.start("c1", { studioName: "Card Films" }, NOW)).state;
  let pub = db.docs.get("studios/c1");
  assert.equal(pub.studioName, "Card Films");
  assert.equal(pub.bestFilm, null);
  for (const k of ["bank", "currentProject", "campaignId", "stats", "upgrades", "recent", "passesAvailable"]) assert.ok(!(k in pub), "no " + k + " on the public card");
  const grosses = [];
  for (let i = 0; i < 3; i++) {
    const g = playable(st)[0], o = await store.release("c1", { index: st.currentProject.index, pick: i === 1 ? bestFilm(st, g) : cheapest(st, g) }, NOW + i);
    grosses.push(o.film.gross); st = o.state;
  }
  pub = db.docs.get("studios/c1");
  assert.equal(pub.bestFilm.gross, Math.max(...grosses), "the highest-grossing film");
  assert.equal(pub.filmsMade, 3);
  assert.equal(pub.level, camp.levelFor(C, st.lifetimeGross));
  assert.ok(Object.values(pub.badges).every((t) => Number.isInteger(t)), "badges as tiers");
  await store.style("c1", { tagline: "Big screams", color: "teal" }, NOW);
  assert.equal(db.docs.get("studios/c1").profile.tagline, "Big screams");
  await store.rename("c1", { name: "Card Pictures" });
  assert.equal(db.docs.get("studios/c1").studioName, "Card Pictures");
  // Studios from before the card: the best of their recent films.
  const old = camp.normalize({ ...st, bestFilm: undefined, recent: [{ title: "A", genre: "horror", gross: 300, profit: 50, no: 1 }, { title: "B", genre: "comedy", gross: 500, profit: 80, no: 2 }] });
  assert.equal(old.bestFilm.title, "B");
});

// ---- studio type (onboarding) and breakouts
test("studio type: four answers pick one of five types; chosen once; effects reach the project", () => {
  const I = C.idn, st0 = studio(0, { index: 2 });
  const ans = (ids) => ({ answers: ids });
  rejects(() => camp.identity(C, st0, "u1", ans(["crowd"])), /Answer every question/);
  rejects(() => camp.identity(C, st0, "u1", ans(["crowd", "big", "stars", "__proto__"])), /isn't one of the answers/);
  rejects(() => camp.identity(C, st0, "u1", ans([1, 2, 3, 4])), /isn't one of the answers/);
  // Every type can be reached, and each answer combination gives exactly one type.
  const seen = new Set();
  (function rec(k, acc) {
    if (k === I.questions.length) { seen.add(camp.typeFor(C, acc)); return; }
    for (const a of I.questions[k].answers) rec(k + 1, acc.concat([a]));
  })(0, []);
  assert.deepEqual([...seen].sort(), I.types.map((t) => t.id).sort(), "all five types reachable");
  const gs = plain(camp.identity(C, st0, "u1", ans(["thrills", "lean", "fresh", "showman"])));
  assert.equal(gs.identity.type, "genre");
  rejects(() => camp.identity(C, gs, "u1", ans(["crowd", "big", "stars", "gamble"])), /already set/);
  const fx = I.types.find((t) => t.id === "genre").effects, env = gs.currentProject.env;
  assert.equal(env.ident.horror, fx.genres.horror, "genre lean in the env");
  assert.equal(env.ident.horrorcomedy, Math.round(((fx.genres.horror || 0) + (fx.genres.comedy || 0)) / 2 * 10000) / 10000, "a blend averages its halves");
  assert.equal(env.disc.talent, -fx.fees === 0 ? undefined : Math.round((1 - (1 + fx.fees)) * 10000) / 10000, "cheaper talent");
  assert.equal(gs.currentProject.budget, Math.min(Math.round(cfg.caps.D * (1 + fx.cap)), Math.max(cfg.start.floor, gs.bank)), "budget cap moves");
  assert.deepEqual(gs.currentProject.env.plots, st0.currentProject.env.plots, "same project, same pitches");
  // The lean shows up as a Studio type step in the score.
  const g = playable(gs).includes("horror") ? "horror" : playable(gs)[0], p = cheapest(gs, g);
  const r = m.evalFilm(camp.projectEnv(gs.currentProject), p, m.DIFFS[gs.currentProject.diff]);
  if (fx.genres[g]) assert.ok(r.steps.some((s) => s.k === "Studio type"));
  assert.equal(camp.publicStudio(C, "u1", gs, NOW).type, "genre", "the type is on the public card");
});

test("breakouts: films near the best possible spin the wheel; the multiplier lands in the score", () => {
  const W = cfg.breakout.wheel;
  let hits = 0, misses = 0;
  const slots = new Array(W.length).fill(0);
  for (let i = 0; i < 24; i++) {
    const st = studio(0, { index: 40 + i, films: 5 }), g = playable(st)[0], pj = st.currentProject, dcfg = m.DIFFS[pj.diff], env = camp.projectEnv(pj);
    const best = m.bestPossible(env, g, dcfg), cheap = cheapest(st, g);
    for (const p of [best.p, cheap]) {
      const out = camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW);
      // Breakouts judge the film before any on-set luck; the wheel then applies to the film with its event.
      const r0 = m.evalFilm(env, p, dcfg), withEvent = m.evalFilm(filmEnv(pj, { ...out.film, breakout: null }), p, dcfg);
      const b = out.film.breakout, share = r0.profit / best.profit;
      if (share >= cfg.breakout.threshold - 1e-9 && r0.profit > 0) {
        assert.ok(b, `breakout expected at ${share.toFixed(3)}`);
        assert.ok(W.some((w) => w.x === b.x));
        assert.ok(Math.abs(out.film.gross - Math.round(withEvent.gross * b.x)) <= 1, "gross multiplied by the wheel");
        assert.ok(out.film.profit > round(withEvent.profit), "profit grows");
        assert.ok(out.events.breakout && out.state.stats.breakouts === 1);
        slots[b.slot]++; hits++;
        // Same project and film: same spin.
        assert.deepEqual(plain(camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW).film.breakout), plain(b));
      } else { assert.equal(b, null, `no breakout at ${share.toFixed(3)}`); misses++; }
    }
  }
  assert.ok(hits >= 10, "the best film breaks out (" + hits + ")");
  // Wildcard studios break out lower; Talent Agency higher.
  const wild = { ...studio(0, { index: 7 }), identity: { type: "wildcard" } }, tal = { ...studio(0, { index: 7 }), identity: { type: "talent" } };
  const pj = wild.currentProject, g = playable(wild)[0], env = camp.projectEnv(pj), dcfg = m.DIFFS[pj.diff];
  const fake = (share) => ({ profit: share * m.bestPossible(env, g, dcfg).profit });
  const T = (id) => cfg.breakout.threshold + (C.idn.types.find((t) => t.id === id).effects.breakout || 0);
  assert.ok(camp.breakoutFor(C, wild, pj, env, cheapest(wild, g), dcfg, fake(T("wildcard") + 0.005)), "wildcard breaks out lower");
  assert.equal(camp.breakoutFor(C, wild, pj, env, cheapest(wild, g), dcfg, fake(T("wildcard") - 0.01)), null);
  assert.equal(camp.breakoutFor(C, tal, pj, env, cheapest(wild, g), dcfg, fake(cfg.breakout.threshold + 0.01)), null, "talent agency needs more");
});
function round(x) { return Math.round(x * 10) / 10; }

test("raising a ladder threshold never takes an unlock away from a studio that reached it", () => {
  // A studio that reached the A-list before the threshold went up (lifetime below today's A-list bar).
  const top = cfg.ladder[cfg.ladder.length - 1], below = top.at - 100;
  const st = { ...studio(below, { films: 20, bank: 150 }) };
  st.gates = Object.fromEntries(cfg.ladder.map((s) => [s.id, NOW]));
  st.unlocked = { ...st.unlocked, actorTier: "A", directorTier: "A", genres: camp.unlocksFor(C, top.at).genres, hard: true };
  st.currentProject = plain(camp.makeProject(C, st, "u1", DATE, false));
  const g = playable(st)[0], out = camp.release(C, st, "u1", { index: st.currentProject.index, pick: cheapest(st, g) }, DATE, NOW);
  assert.equal(out.state.unlocked.actorTier, "A", "still A-list");
  assert.equal(out.state.unlocked.hard, true);
  assert.deepEqual(out.events.gates, [], "no unlock fires again");
  assert.equal(camp.unlocksFor(C, below).actorTier !== "A", true, "without the reached gates it would have dropped");
});

// ---- awards
const awardsLib = require("../../functions/awards.js");
test("award scores: 0-100, and a director who fits the story scores higher than one who doesn't", () => {
  const env = m.makeEnv("2026-11-02"), g = "horror", cfgE = m.DIFFS.medium, pl = m.poolsFor(env, g);
  const p = { g, d: "peele", a1: pl[0][0], a2: pl[1][0], a3: pl[2][0], w: "hallow" };
  const sc = awardsLib.filmScores(m, C.awd, env, p, cfgE, m.evalFilm(env, p, cfgE));
  for (const k of ["critics", "director", "lead", "supporting", "villain", "screenplay", "ensemble"]) assert.ok(sc[k] >= 0 && sc[k] <= 100, k + " " + sc[k]);
  const off = awardsLib.filmScores(m, C.awd, env, { ...p, d: "chu" }, cfgE, m.evalFilm(env, { ...p, d: "chu" }, cfgE));
  assert.ok(sc.director > off.director, "a horror specialist directs horror better than a rom-com director");
});

test("Golden Reel Awards: every season of films faces rival bars; wins pay the bank, not lifetime profit", () => {
  let st = { ...studio(0, { films: 0, index: 0 }), identity: { type: "genre" } }, ceremony = null, before = null;
  for (let i = 0; i < C.awd.season.films; i++) {
    const g = playable(st)[0];
    before = st;
    const out = camp.release(C, st, "u1", { index: st.currentProject.index, pick: bestFilm(st, g) }, DATE, NOW + i);
    assert.ok(out.film.scores && out.film.scores.critics >= 0);
    if (out.events.season) ceremony = { out, before };
    else assert.equal(out.state.season.length, i + 1);
    st = plain(out.state);
  }
  assert.ok(ceremony, "the season ends with a ceremony");
  const { out } = ceremony, sea = out.events.season;
  assert.equal(sea.wins.length + sea.losses.length, C.awd.season.categories.length);
  assert.equal(sea.prize, sea.wins.reduce((a, w) => a + w.prize, 0));
  assert.equal(out.state.season.length, 0, "the next season starts empty");
  assert.equal(out.state.trophies ? out.state.trophies.total : 0, sea.wins.length);
  const filmMoney = Math.max(cfg.start.floor, Math.round((ceremony.before.bank + out.film.profit) * 10) / 10);
  const badgeCash = out.film.badges.reduce((a, b) => a + b.reward, 0);
  assert.equal(out.state.bank, Math.round((filmMoney + sea.prize + badgeCash) * 10) / 10, "prize money (and badge rewards) go to the bank");
  assert.equal(out.state.bonusPoints || 0, sea.wins.reduce((a, w) => a + (w.points || 0), 0), "Best Picture gives an upgrade point");
  assert.equal(out.state.lifetimeProfit, Math.round((ceremony.before.lifetimeProfit + Math.max(0, out.film.profit)) * 10) / 10, "lifetime profit only counts the film");
  // Same studio, same season: the same ceremony (seeded).
  assert.deepEqual(plain(camp.release(C, ceremony.before, "u1", { index: ceremony.before.currentProject.index, pick: out.film.pick }, DATE, NOW).events.season), plain(sea));
});

test("Greenlight Globes: submit this week's films, the week closes, winners are paid once", async () => {
  const db = fakeDb(), store = makeStore(db, C, fakeFiles({}));
  const wk = awardsLib.weekOf(NOW), players = ["g1", "g2", "g3"];
  for (const uid of players) {
    let st = (await store.start(uid, { studioName: "Studio " + uid }, NOW)).state;
    const idx = [];
    for (let i = 0; i < 2; i++) {
      const g = playable(st)[0], o = await store.release(uid, { index: st.currentProject.index, pick: uid === "g2" ? bestFilm(st, g) : cheapest(st, g) }, NOW + i);
      idx.push(o.film.projectIndex); st = o.state;
    }
    await assert.rejects(store.submitAwards(uid, { films: [] }, NOW), /Pick 1 to/);
    await assert.rejects(store.submitAwards(uid, { films: [0, 0] }, NOW), /different films/);
    await assert.rejects(store.submitAwards(uid, { films: [99] }, NOW), /can't be entered/);
    await assert.rejects(store.submitAwards(uid, { films: idx }, wk.end + 1000), /released this week/);
    const r = await store.submitAwards(uid, { films: idx }, NOW + 5000);
    assert.equal(r.week, wk.id);
    assert.equal(db.docs.get(`awards/${wk.id}/entries/${uid}`).films.length, 2);
  }
  const bankBefore = Object.fromEntries(players.map((u) => [u, db.docs.get(`campaigns/${u}`).bank]));
  const res = await store.finalizeWeek(wk.id, NOW + 7 * 86400000);
  assert.equal(res.entries, 3);
  const head = db.docs.get(`awards/${wk.id}`);
  assert.equal(head.status, "final");
  const pic = head.results.picture;
  assert.ok(pic.length >= 1 && pic.length <= C.awd.weekly.podium);
  assert.ok(pic.every((x, i) => i === 0 || x.value <= pic[i - 1].value), "ranked best first");
  const winner = pic[0].uid, w = db.docs.get(`campaigns/${winner}`);
  assert.ok(w.globes.wins >= 1 && w.globes.byCat.picture === 1);
  assert.ok(w.bank > bankBefore[winner], "prize money paid");
  assert.ok(w.badges.globe, "Globe Winner badge");
  assert.equal(db.docs.get(`studios/${winner}`).globes, w.globes.wins, "on the public card");
  const again = await store.finalizeWeek(wk.id, NOW + 8 * 86400000);
  assert.ok(again.skipped, "a week is finalised once");
  assert.equal(db.docs.get(`campaigns/${winner}`).globes.wins, w.globes.wins, "no double prize");
});

test("Genre Master: earned with hits and acclaim, claimed by choice, at most two; a bonus inside, a cost outside", () => {
  const GM = C.badges.genre_master, base = studio(0, { index: 3 });
  rejects(() => camp.master(C, base, "u1", { genre: "horror" }), /hasn't earned/);
  const ready = { ...base, genreHits: { horror: GM.films, comedy: GM.films, drama: GM.films }, genreAcclaim: { horror: GM.acclaimed, comedy: GM.acclaimed, drama: GM.acclaimed - 1 } };
  assert.deepEqual(camp.masterReady(C, ready).sort(), ["comedy", "horror"], "drama lacks acclaim");
  rejects(() => camp.master(C, ready, "u1", { genre: "drama" }), /hasn't earned/);
  rejects(() => camp.master(C, ready, "u1", { genre: "__proto__" }), /hasn't earned/);
  let st = plain(camp.master(C, ready, "u1", { genre: "horror" }, NOW).state);
  assert.ok(st.perks.horror && st.badges.genre_master.tier === 1);
  const env = st.currentProject.env;
  assert.equal(env.bonus.horror, GM.bonus, "mastered genre up");
  assert.equal(env.bonus.drama, GM.offGenre, "outside your mastery: down");
  assert.equal(env.bonus.horrorcomedy, undefined, "a blend with a mastered half is neutral");
  st = plain(camp.master(C, { ...st, genreHits: ready.genreHits, genreAcclaim: ready.genreAcclaim }, "u1", { genre: "comedy" }, NOW).state);
  assert.equal(Object.keys(st.perks).length, 2);
  rejects(() => camp.master(C, { ...st, genreHits: { ...ready.genreHits, drama: 9 }, genreAcclaim: { ...ready.genreAcclaim, drama: 9 } }, "u1", { genre: "drama" }), /at most 2/);
  assert.deepEqual(camp.masterReady(C, st), [], "nothing more to claim at the cap");
  // The penalty is real in the score: an off-specialty film earns less than the same film without mastery.
  const g = ["drama", "romance", "comedy"].find((x) => st.currentProject.genres[x] && st.currentProject.genres[x].state === "ok") || "drama";
  if (st.currentProject.genres[g] && st.currentProject.genres[g].state === "ok" && !st.perks[g]) {
    const p = cheapest(st, g), dcfg = m.DIFFS[st.currentProject.diff];
    const withM = m.evalFilm(camp.projectEnv(st.currentProject), p, dcfg), without = m.evalFilm({ ...camp.projectEnv(st.currentProject), bonus: {} }, p, dcfg);
    assert.ok(withM.gross < without.gross && withM.steps.some((x) => x.k === "Off your specialty"));
  }
  // Older studios with more than two masteries keep the first two.
  assert.equal(Object.keys(camp.normalize({ ...base, perks: { horror: 1, comedy: 1, drama: 1 } }).perks).length, 2);
  // Acclaimed hits are counted at release.
  const r0 = studio(0, { films: 0, index: 21 }), gg = playable(r0)[0], out = camp.release(C, r0, "u1", { index: r0.currentProject.index, pick: bestFilm(r0, gg) }, DATE, NOW);
  assert.equal(out.state.genreAcclaim[gg] || 0, out.film.profit > 0 && out.film.scores.critics >= GM.critics ? 1 : 0);
});

// ---- campaign stories: fatigue, declines, traits and events, rotation, audience score
const storiesLib = require("../../functions/events.js");
test("audience fatigue: repeating a script, director, actors or genre costs box office (capped)", () => {
  const E = C.evt, st = studio(0, { index: 5 }), g = playable(st)[0], p = cheapest(st, g), pj = st.currentProject, dcfg = m.DIFFS[pj.diff];
  const base = camp.projectEnv(pj), fresh = m.evalFilm({ ...base, hist: null }, p, dcfg);
  const hist = (picks, made) => storiesLib.histFor(E, { recentPicks: picks, madeScripts: made || {}, perks: {} });
  const same = { g, d: p.d, cast: [p.a1, p.a2, p.a3], s: base.plots[g] };
  const tired = m.evalFilm({ ...base, hist: hist([same, same], { [g + "|" + base.plots[g]]: 2 }) }, p, dcfg);
  assert.ok(tired.gross < fresh.gross && tired.steps.some((s) => s.k === "Audience fatigue"));
  const q = m.fatigueQ({ ...base, hist: hist([same, same, same, same], { [g + "|" + base.plots[g]]: 9 }) }, p);
  assert.equal(q, Math.round((1 - E.fatigue.cap) * 100) / 100, "capped");
  assert.equal(m.fatigueQ({ ...base, hist: hist([]) }, p), 1, "nothing recent, no fatigue");
  // The release remembers what you made.
  const out = camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW);
  assert.equal(out.state.recentPicks[0].d, p.d);
  assert.equal(out.state.madeScripts[g + "|" + base.plots[g]], 1);
});

test("talent declines: new studios hear no more often, enough people always stay, declined people can't be cast", () => {
  const D = C.evt.declines;
  let newNo = 0, vetNo = 0, n = 0;
  for (let i = 0; i < 30; i++) {
    const fresh = studio(0, { index: 100 + i }), vet = { ...studio(0, { index: 100 + i }), lifetimeGross: cfg.levels[8], upgrades: { reputation: 3 } };
    vet.currentProject = plain(camp.makeProject(C, vet, "u1", DATE, false));
    for (const g of playable(fresh)) {
      const gs = fresh.currentProject.genres[g];
      newNo += gs.declined.length; n++;
      ["a1", "a2", "a3"].forEach((r) => assert.ok(gs.pools[r].length >= D.keepPerRole, "enough left per role"));
      assert.ok(gs.dirs.length >= Math.min(D.keepDirectors, gs.dirs.length + gs.declined.filter((x) => x.role === "d").length));
      gs.declined.forEach((x) => assert.ok(!gs.pools.a1.includes(x.id) && !gs.dirs.includes(x.id) && D.reasons.includes(x.reason)));
      if (vet.currentProject.genres[g] && vet.currentProject.genres[g].declined) vetNo += vet.currentProject.genres[g].declined.length;
    }
  }
  assert.ok(newNo > vetNo, `new studios turned down more (${newNo} vs ${vetNo})`);
  const st = studio(0, { index: 101 }), g = playable(st)[0], gs = st.currentProject.genres[g], no = gs.declined.find((x) => x.role === "a1");
  if (no) rejects(() => camp.release(C, st, "u1", { index: st.currentProject.index, pick: { ...cheapest(st, g), a1: no.id } }, DATE, NOW), /shortlist/);
});

test("on-set events: about the configured share of films, seeded, and they move box office, cost or critics", () => {
  let withEv = 0, n = 0;
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    const st = studio(0, { index: 200 + i }), g = playable(st)[0], p = cheapest(st, g), pj = st.currentProject;
    const out = camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW);
    n++;
    if (out.film.event) {
      withEv++; seen.add(out.film.event.id);
      const ev = out.film.event;
      assert.ok(ev.text && !/\{[abd]\}/.test(ev.text), "names filled in");
      if (ev.gross !== 1) assert.ok(m.evalFilm(filmEnv(pj, out.film), p, m.DIFFS[pj.diff]).steps.some((s) => s.k === "On set"));
      assert.deepEqual(plain(camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW).film.event), plain(ev), "seeded");
    }
  }
  const share = withEv / n;
  assert.ok(share > C.evt.chance - 0.2 && share < C.evt.chance + 0.2, "event share " + share.toFixed(2));
  assert.ok(seen.size >= 4, "a variety of events: " + [...seen].join(","));
  // Traits differ between studios (seeded per campaign).
  const t1 = m.ACTORS.map((a) => (storiesLib.traitOf(m, C.evt, "u1|c1", a.id) || {}).id).join(), t2 = m.ACTORS.map((a) => (storiesLib.traitOf(m, C.evt, "u2|c9", a.id) || {}).id).join();
  assert.notEqual(t1, t2);
});

test("shortlist rotation: people you hired recently show up less often", () => {
  // At C-list there are more people than slots (at D-list every D-list woman is always needed).
  const u = camp.unlocksFor(C, cfg.ladder[1].at), g = u.genres[0];
  let base = 0, after = 0;
  const target = camp.castPools(C, "rot|0", g, u.actorTier).pools[0][0];
  for (let i = 0; i < 120; i++) {
    if (camp.castPools(C, "rot|" + i, g, u.actorTier).pools.flat().includes(target)) base++;
    if (camp.castPools(C, "rot|" + i, g, u.actorTier, { [target]: 2 }).pools.flat().includes(target)) after++;
  }
  assert.ok(after < base, `${target}: ${base} -> ${after} of 120 shortlists`);
});

test("audience score: 0-100 on every film, lower when audiences are tired of you", () => {
  const st = studio(0, { index: 7 }), g = playable(st)[0], p = cheapest(st, g), pj = st.currentProject, dcfg = m.DIFFS[pj.diff], env = camp.projectEnv(pj);
  const a0 = awardsLib.filmScores(m, C.awd, { ...env, hist: null }, p, dcfg, m.evalFilm(env, p, dcfg)).audience;
  const tiredEnv = { ...env, hist: storiesLib.histFor(C.evt, { recentPicks: [{ g, d: p.d, cast: [p.a1, p.a2, p.a3] }, { g, d: p.d, cast: [p.a1, p.a2, p.a3] }], madeScripts: { [g + "|" + env.plots[g]]: 2 }, perks: {} }) };
  const a1 = awardsLib.filmScores(m, C.awd, tiredEnv, p, dcfg, m.evalFilm(tiredEnv, p, dcfg)).audience;
  assert.ok(a0 >= 0 && a0 <= 100 && a1 < a0, `${a0} -> ${a1}`);
  const out = camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW);
  assert.ok(Number.isInteger(out.film.scores.audience) && out.state.recent[0].audience === out.film.scores.audience);
});

// ---- relationships: films, on-set events and awards move them; they decide who works with you and for how much
test("relationships: hits and good events raise them, flops and fights lower them, clamped", () => {
  const E = C.evt, R = E.relationships, p = { d: "d1", a1: "x", a2: "y", a3: "z" };
  const hit = storiesLib.relDeltas(E, p, 50, 80, null, null);
  assert.equal(hit.d1, R.film.hit + R.film.audienceHigh);
  const flop = storiesLib.relDeltas(E, p, -20, 30, null, { id: "clash", a: "x", b: "y", d: "d1" });
  assert.equal(flop.x, R.film.flop + R.film.audienceLow + R.events.clash.a);
  assert.equal(flop.z, R.film.flop + R.film.audienceLow);
  const boom = storiesLib.relDeltas(E, p, 50, 60, { x: 2 }, { id: "chemistry", a: "x", b: "y", d: "d1" });
  assert.equal(boom.y, R.film.breakout + R.events.chemistry.b);
  const { rel, changes } = storiesLib.applyRel(E, { x: 95 }, { x: 20, y: -500 });
  assert.equal(rel.x, R.max); assert.equal(rel.y, R.min); assert.equal(changes.length, 2);
});

test("relationships: feuds refuse, friends say yes and get a friends rate", () => {
  const E = C.evt, R = E.relationships, base = studio(0, { index: 300 }), g = playable(base)[0];
  const gs0 = base.currentProject.genres[g], foe = gs0.pools.a1[0], pal = gs0.dirs[0];
  const st = { ...base, rel: { [foe]: R.feud - 5, [pal]: R.friend + 10 } };
  st.currentProject = plain(camp.makeProject(C, st, "u1", DATE, false));
  const gs = st.currentProject.genres[g];
  const all = [...gs.pools.a1, ...gs.pools.a2, ...gs.pools.a3];
  assert.ok(!all.includes(foe), "feuding actor never on the shortlist");
  const no = gs.declined.find((x) => x.id === foe);
  if (no) assert.equal(no.feud, true);
  const env = camp.projectEnv(st.currentProject);
  if (gs.dirs.includes(pal)) assert.equal(m.talentFee(env, m.D[pal]), Math.round(Math.round(m.D[pal].fee * (1 - ((env.disc && env.disc.talent) || 0))) * (1 - R.friendFee)));
  assert.equal(env.relFee[foe], 1 + R.strainedFee);
});

test("relationships: every release moves them for the director and cast", () => {
  const st = studio(0, { index: 301 }), g = playable(st)[0], p = cheapest(st, g), pj = st.currentProject;
  const out = camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW);
  [p.d, p.a1, p.a2, p.a3].forEach((id) => assert.ok(typeof out.state.rel[id] === "number" && out.state.rel[id] !== 0, id));
  assert.ok(out.events.rel.length >= 4);
});

// ---- popcorn (audience) score: word of mouth on the film itself, fan base on the next ones
test("popcorn: word of mouth and fan base follow the audience score, capped", () => {
  const E = C.evt, P = E.popcorn;
  assert.equal(storiesLib.womFor(E, P.mid), 1);
  assert.ok(storiesLib.womFor(E, 90) > 1 && storiesLib.womFor(E, 30) < 1);
  assert.equal(storiesLib.womFor(E, 1000), Math.round((1 + P.womCap) * 100) / 100);
  assert.equal(storiesLib.fansFor(E, { popcorn: [90] }), 1, "one film isn't a fan base yet");
  assert.ok(storiesLib.fansFor(E, { popcorn: [90, 85, 88] }) > 1 && storiesLib.fansFor(E, { popcorn: [30, 35] }) < 1);
  const st = studio(0, { index: 400 }), g = playable(st)[0], p = cheapest(st, g), pj = st.currentProject, dcfg = m.DIFFS[pj.diff];
  const env = camp.projectEnv(pj), loved = m.evalFilm({ ...env, fans: 1.1 }, p, dcfg), plainR = m.evalFilm({ ...env, fans: 1 }, p, dcfg);
  assert.ok(loved.gross > plainR.gross && loved.steps.some((s) => s.k === "Fan base"));
  const out = camp.release(C, st, "u1", { index: pj.index, pick: p }, DATE, NOW);
  assert.equal(out.state.popcorn[0], out.film.scores.audience);
  assert.equal(out.film.wom || 1, storiesLib.womFor(E, out.film.scores.audience));
  // Talent is keener on studios audiences love.
  let lovedNo = 0, hatedNo = 0;
  for (let i = 0; i < 20; i++) {
    const a = { ...studio(0, { index: 500 + i }), popcorn: [95, 95, 95] }, b = { ...studio(0, { index: 500 + i }), popcorn: [20, 20, 20] };
    [[a, (n) => (lovedNo += n)], [b, (n) => (hatedNo += n)]].forEach(([s, add]) => {
      const pjx = camp.makeProject(C, s, "u1", DATE, false);
      Object.values(pjx.genres).forEach((x) => add((x.declined || []).length));
    });
  }
  assert.ok(lovedNo < hatedNo, `${lovedNo} vs ${hatedNo}`);
});

test("restart: a fresh run under the same name and look; project indexes keep counting", () => {
  const st0 = studio(0, { index: 600 }), g = playable(st0)[0], pj = st0.currentProject;
  const played = camp.release(C, st0, "u1", { index: pj.index, pick: cheapest(st0, g) }, DATE, NOW).state;
  const st = { ...played, profile: { color: "red", tagline: "Hi" }, rel: { x: 50 }, upgrades: { reputation: 1 } };
  rejects(() => camp.restart(C, st, "u1", {}, DATE, NOW), /Confirm/);
  const out = camp.restart(C, st, "u1", { confirm: "RESTART" }, DATE, NOW);
  assert.equal(out.studioName, st.studioName);
  assert.deepEqual(out.profile, st.profile);
  assert.equal(out.filmsMade, 0); assert.equal(out.bank, cfg.start.bank); assert.equal(out.lifetimeProfit, 0);
  assert.deepEqual(out.upgrades, {}); assert.ok(!out.rel || !Object.keys(out.rel).length); assert.ok(!out.identity);
  assert.notEqual(out.campaignId, st.campaignId);
  assert.equal(out.firstIndex, st.projectIndex); assert.equal(out.currentProject.index, st.projectIndex);
  assert.equal(out.restarts, 1);
});
