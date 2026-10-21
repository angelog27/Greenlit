// The release Cloud Function's check (functions/game.js): honest films are scored exactly like the page,
// tampered ones are rejected. Builds functions/gen from the current page and data first.
// Run: node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadModel } from "../../tools/model_loader.mjs";

const root = new URL("../../", import.meta.url);
execFileSync(process.execPath, [fileURLToPath(new URL("tools/build_functions.mjs", root))]);
const { loadGame, check, Reject } = createRequire(import.meta.url)("../../functions/game.js");
const game = loadGame();
const m = game.m;

const NOW = Date.parse("2026-10-19T15:00:00Z"), DAY = "2026-10-19";
const env = m.makeEnv(DAY);
const winIds = m.WINDOWS.filter((w) => !w.hardOnly).map((w) => w.id);

// The cheapest film for a genre today, so it is always within budget.
function honest(gid, diff) {
  const cfg = m.DIFFS[diff], byFee = (ids, M) => ids.slice().sort((a, b) => M[a].fee - M[b].fee)[0];
  const pools = m.poolsFor(env, gid);
  const w = cfg.real ? env.dates.slice().sort((a, b) => m.W[m.seasonOf(a)].cost - m.W[m.seasonOf(b)].cost)[0] : winIds.slice().sort((a, b) => m.W[a].cost - m.W[b].cost)[0];
  return { g: gid, d: byFee(m.dirsFor(env, gid), m.D), a1: byFee(pools[0], m.A), a2: byFee(pools[1], m.A), a3: byFee(pools[2], m.A), w };
}
const playable = m.GENRES.map((g) => g.id).filter((g) => m.costOf(honest(g, "medium"), m.DIFFS.medium) <= env.budget);
const G0 = playable[0];
const rejects = (input, re) => assert.throws(() => check(game, input, NOW), (e) => e instanceof Reject && re.test(e.message));

test("an honest film is scored exactly like the page scores it", () => {
  const page = loadModel(new URL("Frontend/greenlight.html", root));
  page.initModel(JSON.parse(JSON.stringify({ genres: m.GENRES, directors: m.DIRS, actors: m.ACTORS, plots: m.PLOTS, windows: m.WINDOWS,
    loyal: m.LOYAL.map(([director, actor, bonus, films]) => ({ director, actor, bonus, films })), chem: m.CHEM.map(([a, b, bonus, films]) => ({ a, b, bonus, films })),
    slate: m.SLATE_RAW.map(([date, title, genre, strength]) => ({ date, title, genre, strength })) })));
  for (const diff of ["easy", "medium", "hard"]) {
    for (const g of playable) {
      const pick = honest(g, diff);
      if (m.costOf(pick, m.DIFFS[diff]) > env.budget) continue;
      const out = check(game, { type: "basic", diff, day: DAY, pick }, NOW);
      const want = page.evalFilm(page.makeEnv(DAY), pick, page.DIFFS[diff]);
      assert.equal(out.profit, want.profit, `${diff} ${g}`);
      assert.equal(out.gross, want.gross);
      assert.equal(out.board, `r3-basic-${diff}_${DAY}`);
    }
  }
});

test("the daily challenge must be Hard and today's genre", () => {
  const pick = honest(env.daily, "hard");
  if (m.costOf(pick, m.DIFFS.hard) <= env.budget) assert.ok(check(game, { type: "daily", diff: "hard", day: DAY, pick }, NOW));
  rejects({ type: "daily", diff: "easy", day: DAY, pick }, /always played on Hard/);
  const other = playable.find((g) => g !== env.daily);
  rejects({ type: "daily", diff: "hard", day: DAY, pick: honest(other, "hard") }, /Daily Challenge genre/);
});

test("only today (or yesterday, for a film started before midnight UTC) is accepted", () => {
  const pick = honest(G0, "medium");
  rejects({ type: "basic", diff: "medium", day: "2026-10-17", pick }, /closed/);
  rejects({ type: "basic", diff: "medium", day: "2026-10-20", pick }, /closed/);
});

test("people and slots must come from that day's shortlists", () => {
  const pick = honest(G0, "medium"), base = { type: "basic", diff: "medium", day: DAY };
  const offDir = m.DIRS.map((d) => d.id).find((id) => !m.dirsFor(env, G0).includes(id));
  if (offDir) rejects({ ...base, pick: { ...pick, d: offDir } }, /director/);
  const pools = m.poolsFor(env, G0);
  rejects({ ...base, pick: { ...pick, a1: pools[1][0] } }, /cast/);
  const outsider = m.ACTORS.map((a) => a.id).find((id) => !pools.flat().includes(id));
  rejects({ ...base, pick: { ...pick, a3: outsider } }, /cast/);
  rejects({ ...base, pick: { ...pick, w: "winter" } }, /release slot/);
  rejects({ ...base, diff: "hard", pick: { ...pick, w: "summer" } }, /release slot/);
});

test("over-budget, malformed and prototype-key picks are rejected", () => {
  const pick = honest(G0, "medium"), base = { type: "basic", diff: "medium", day: DAY };
  const pools = m.poolsFor(env, G0), dear = (ids, M) => ids.slice().sort((a, b) => M[b].fee - M[a].fee)[0];
  const pricey = { ...pick, d: dear(m.dirsFor(env, G0), m.D), a1: dear(pools[0], m.A), a2: dear(pools[1], m.A), a3: dear(pools[2], m.A) };
  if (m.costOf(pricey, m.DIFFS.medium) > env.budget) rejects({ ...base, pick: pricey }, /over today's budget/);
  rejects({ ...base, pick: { ...pick, g: "__proto__" } }, /Unknown genre/);
  rejects({ ...base, pick: { ...pick, g: "constructor" } }, /Unknown genre/);
  rejects({ ...base, diff: "toString" }, /Unknown difficulty/);
  rejects({ ...base, type: "ranked" }, /Unknown game mode/);
  rejects({ ...base, pick: null }, /No film/);
  rejects(null, /Unknown game mode/);
});

test("director shortlist: 8 per day and genre, deterministic, specialists favoured", () => {
  let spec = 0, n = 0;
  for (let i = 0; i < 30; i++) {
    const e = m.makeEnv(m.addDays(DAY, i));
    for (const g of m.GENRES) {
      const a = m.dirsFor(e, g.id);
      assert.equal(a.length, 8);
      assert.equal(new Set(a).size, 8);
      assert.deepEqual(m.dirsFor(e, g.id), a);
      a.forEach((id) => { n++; if (m.inGenre(m.D[id].spec, g.id)) spec++; });
    }
  }
  const base = m.DIRS.length;
  assert.ok(base > 8);
  assert.ok(spec / n > 0.3, `specialists are ${Math.round((spec / n) * 100)}% of shortlists`);
});

test("a shuffled Basic story is scored with that story; it must be one of the genre's pitches for the day", () => {
  const page = loadModel(new URL("Frontend/greenlight.html", root));
  page.initModel(JSON.parse(JSON.stringify({ genres: m.GENRES, directors: m.DIRS, actors: m.ACTORS, plots: m.PLOTS, windows: m.WINDOWS,
    loyal: m.LOYAL.map(([director, actor, bonus, films]) => ({ director, actor, bonus, films })), chem: m.CHEM.map(([a, b, bonus, films]) => ({ a, b, bonus, films })),
    slate: m.SLATE_RAW.map(([date, title, genre, strength]) => ({ date, title, genre, strength })) })));
  const base = { type: "basic", diff: "medium", day: DAY }, pick = honest(G0, "medium");
  const choices = [...m.plotChoices(DAY, G0)], other = choices.find((i) => i !== env.plots[G0]);
  const out = check(game, { ...base, pick: { ...pick, s: other } }, NOW);
  const want = page.evalFilm(page.envWithPlot(page.makeEnv(DAY), G0, other), pick, page.DIFFS.medium);
  assert.equal(out.profit, want.profit);
  assert.equal(out.title, m.PLOTS[G0][other].title);
  assert.equal(out.p.s, other);
  assert.equal(check(game, { ...base, pick }, NOW).p.s, env.plots[G0], "no s means the day's story");
  const later = m.PLOTS[G0].findIndex((p) => p.from && p.from > DAY);
  if (later > -1) rejects({ ...base, pick: { ...pick, s: later } }, /isn't available/);
  rejects({ ...base, pick: { ...pick, s: 99 } }, /isn't available/);
  rejects({ ...base, pick: { ...pick, s: "1" } }, /isn't available/);
  const dp = honest(env.daily, "hard");
  rejects({ type: "daily", diff: "hard", day: DAY, pick: { ...dp, s: m.plotChoices(DAY, env.daily).find((i) => i !== env.plots[env.daily]) } }, /shared story/);
});

test("daily board names: only a name typed at email sign-up, cleaned; Google names never published", () => {
  const { boardName } = createRequire(import.meta.url)("../../functions/game.js");
  assert.equal(boardName("abcdef123", { name: "Jane Q. Public", firebase: { sign_in_provider: "google.com" } }), "Studio ABCDE");
  assert.equal(boardName("abcdef123", { name: "Night Owl <b>Films</b>", firebase: { sign_in_provider: "password" } }), "Night Owl bFilms/b");
  assert.equal(boardName("abcdef123", { name: "x".repeat(500), firebase: { sign_in_provider: "password" } }).length, 30);
  assert.equal(boardName("abcdef123", { firebase: { sign_in_provider: "password" } }), "Studio ABCDE");
  assert.equal(boardName("abcdef123", undefined), "Studio ABCDE");
});

test("rate limits and the image byte check", () => {
  const { makeLimiter, isImageBytes } = createRequire(import.meta.url)("../../functions/limits.js");
  let now = 0;
  const allow = makeLimiter({ default: { max: 3, windowMs: 1000 }, hard: { max: 1, windowMs: 1000 } }, () => now);
  assert.deepEqual([1, 2, 3, 4].map(() => allow("u", "default")), [true, true, true, false]);
  assert.equal(allow("v", "default"), true, "limits are per player");
  assert.equal(allow("u", "hard"), true);
  assert.equal(allow("u", "hard"), false);
  now = 1001;
  assert.equal(allow("u", "default"), true, "the window slides");
  const b = (a) => Uint8Array.from(a.concat(Array(16).fill(0)));
  assert.ok(isImageBytes(b([0xff, 0xd8, 0xff, 0xe0])));
  assert.ok(isImageBytes(b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  assert.ok(isImageBytes(b([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])));
  assert.ok(!isImageBytes(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>")));
  assert.ok(!isImageBytes(Buffer.from("GIF89a...........")));
  assert.ok(!isImageBytes(null));
});

test("script offers: three drafts, one strongest; the server rebuilds the offer and scores the draft's potential", () => {
  const page = loadModel(new URL("Frontend/greenlight.html", root));
  page.initModel(JSON.parse(JSON.stringify({ genres: m.GENRES, directors: m.DIRS, actors: m.ACTORS, plots: m.PLOTS, windows: m.WINDOWS,
    loyal: m.LOYAL.map(([director, actor, bonus, films]) => ({ director, actor, bonus, films })), chem: m.CHEM.map(([a, b, bonus, films]) => ({ a, b, bonus, films })),
    slate: m.SLATE_RAW.map(([date, title, genre, strength]) => ({ date, title, genre, strength })) })));
  for (let n = 0; n < 20; n++) {
    const offer = JSON.parse(JSON.stringify(m.basicOffer(DAY, G0, n)));
    assert.equal(new Set(offer.map((x) => x.s)).size, offer.length, "three different scripts");
    assert.equal(offer.filter((x) => x.q === m.SCRIPT_Q[0]).length, 1, "exactly one strongest draft");
    assert.deepEqual(JSON.parse(JSON.stringify(m.basicOffer(DAY, G0, n))), offer, "deterministic");
  }
  const base = { type: "basic", diff: "medium", day: DAY }, pick = honest(G0, "medium"), offer = m.basicOffer(DAY, G0, 3);
  for (const it of offer) {
    const out = check(game, { ...base, pick: { ...pick, s: it.s, n: 3 } }, NOW);
    const want = page.evalFilm(page.envWithScript(page.makeEnv(DAY), G0, it.s, it.q), pick, page.DIFFS.medium);
    assert.equal(out.profit, want.profit);
    assert.equal(out.p.q, it.q);
    assert.ok(want.steps.some((st) => st.k === "Script potential"), "the draft shows as a step");
  }
  const strong = check(game, { ...base, pick: { ...pick, s: offer.find((x) => x.q === m.SCRIPT_Q[0]).s, n: 3 } }, NOW);
  const weak = check(game, { ...base, pick: { ...pick, s: offer.find((x) => x.q === Math.min(...m.SCRIPT_Q)).s, n: 3 } }, NOW);
  assert.ok(strong.gross > weak.gross || offer.length < 3, "the strong draft has more upside");
  const outside = m.plotChoices(DAY, G0).find((i) => !offer.some((x) => x.s === i));
  if (outside !== undefined) rejects({ ...base, pick: { ...pick, s: outside, n: 3 } }, /wasn't in that offer/);
  rejects({ ...base, pick: { ...pick, s: offer[0].s, n: -1 } }, /offer isn't valid/);
  rejects({ ...base, pick: { ...pick, s: offer[0].s, n: "3" } }, /offer isn't valid/);
  rejects({ type: "daily", diff: "hard", day: DAY, pick: { ...honest(env.daily, "hard"), s: 0, n: 0 } }, /shared story/);
  assert.equal(check(game, { ...base, pick }, NOW).p.q, 1, "the day's own story has no script step");
});
