// Campaign (solo career) rules. Pure functions: a campaign state goes in, the next state comes out, so the
// rules are testable without Firebase; campaign_store.js wraps them in Firestore transactions.
// Films are scored by the page's own model (game.m). A project is an env from makeEnv(date, key) plus the
// shortlists drawn here (env.pools / env.dirs) and the Genre Master perks (env.bonus); nothing is re-implemented.
// All numbers live in data/campaign.json (progression) and data/achievements.json (gates and badges).
const fs = require("fs");
const path = require("path");
const { Reject } = require("./game");

const own = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const round1 = (x) => Math.round(x * 10) / 10;
const ROLES = ["a1", "a2", "a3"];

function loadCampaign(game, dir = path.join(__dirname, "gen", "data")) {
  const rd = (n) => JSON.parse(fs.readFileSync(path.join(dir, n + ".json"), "utf8"));
  return makeCampaign(game, rd("campaign"), rd("achievements"), rd("identity"));
}

// Tiers are derived from stats: the highest tier whose minimum the person meets.
function makeCampaign(game, cfg, ach, idn) {
  const m = game.m, order = cfg.tiers.order;
  const tierOf = (v, mins) => order.reduce((t, x) => (v >= mins[x] - 1e-9 ? x : t), order[0]);
  const actorTier = {}, dirTier = {};
  m.ACTORS.forEach((a) => { actorTier[a.id] = tierOf(a.star, cfg.tiers.actorMinStar); });
  m.DIRS.forEach((d) => { dirTier[d.id] = tierOf(d.skill, cfg.tiers.directorMinSkill); });
  const badges = Object.fromEntries(ach.badges.map((b) => [b.id, b]));
  return { game, m, cfg, ach, idn: idn || { types: [], questions: [] }, badges, order, rank: (t) => order.indexOf(t), actorTier, dirTier };
}

// What a lifetime profit has unlocked: the last tier each ladder step names, every genre named so far.
// `reached` (the studio's gates so far) keeps a step unlocked even if its threshold is raised later, so
// retuning the ladder never takes an unlock away.
function unlocksFor(C, lifetime, reached) {
  const u = { actorTier: C.order[0], directorTier: C.order[0], genres: [], hard: false, gates: [] };
  C.cfg.ladder.forEach((s) => {
    if (lifetime < s.at && !(reached && own(reached, s.id))) return;
    if (s.actors) u.actorTier = s.actors;
    if (s.directors) u.directorTier = s.directors;
    (s.genres || []).forEach((g) => { if (!u.genres.includes(g)) u.genres.push(g); });
    if (s.hard) u.hard = true;
    u.gates.push(s.id);
  });
  u.genres = C.m.GENRES.map((g) => g.id).filter((g) => u.genres.includes(g)); // roster order
  return u;
}
function nextGate(C, lifetime) { return C.cfg.ladder.find((s) => s.at > lifetime) || null; }
function genreUnlockAt(C, gid) { const s = C.cfg.ladder.find((x) => (x.genres || []).includes(gid)); return s ? s.at : null; }

// Next project's budget: the bank, clamped between the floor and the cap of the highest unlocked tier.
function budgetFor(C, st) {
  const top = C.order[Math.max(C.rank(st.unlocked.actorTier), C.rank(st.unlocked.directorTier))];
  const cap = Math.round(C.cfg.caps[top] * (1 + (typeEffects(C, st).cap || 0)));
  return Math.min(cap, Math.max(C.cfg.start.floor, st.bank));
}
// Bank after a film or fee. Below the floor the studio is bailed out back to the floor.
function settle(C, bank) {
  const b = round1(bank);
  return b < C.cfg.start.floor ? { bank: C.cfg.start.floor, bailout: true } : { bank: b, bailout: false };
}

function projectKey(uid, cid, index, salt) { return "camp|" + uid + "|" + cid + "|" + index + (salt ? "|" + salt : ""); }

// Cast shortlists for one genre: per role three men and three women, nobody twice, only unlocked tiers,
// at least freshPerRole per role from the newest unlocked tier when there are enough. Each person draws from
// their own seed (key, genre, id), nudged toward the genre, like poolsFor. If a gender runs out, the cheapest
// people of that gender from the next tier up fill in and are listed as loans.
function castPools(C, key, gid, tier) {
  const m = C.m, sl = C.cfg.shortlist, per = sl.perGender, cap = C.rank(tier);
  const k = (a) => m.seedOf("pool", { day: key }, gid, a.id) - (m.inGenre(a.g, gid) ? 0.5 : 0);
  const keyed = (list, f) => list.map((a) => ({ a, id: a.id, k: f(a) })).sort(m.byK).map((o) => o.a);
  const of = (s, test) => m.ACTORS.filter((a) => a.s === s && test(C.rank(C.actorTier[a.id])));
  const fresh = { m: keyed(of("m", (r) => r === cap), k), f: keyed(of("f", (r) => r === cap), k) };
  // Fresh slots per role and gender: freshPerRole per role, taken from whichever gender has more left.
  const q = { m: [0, 0, 0], f: [0, 0, 0] }, left = { m: fresh.m.length, f: fresh.f.length };
  for (let r = 0; r < 3; r++) {
    for (let n = 0; n < sl.freshPerRole; n++) {
      const ok = ["m", "f"].filter((s) => left[s] > 0 && q[s][r] < per);
      if (!ok.length) break;
      const s = ok.length === 1 ? ok[0] : left.m === left.f ? (n % 2 ? "f" : "m") : left.m > left.f ? "m" : "f";
      q[s][r]++; left[s]--;
    }
  }
  const roles = [[], [], []], loans = [];
  ["m", "f"].forEach((s) => {
    const fq = fresh[s].slice(), used = new Set();
    for (let r = 0; r < 3; r++) for (let i = 0; i < q[s][r]; i++) { const a = fq.shift(); roles[r].push(a); used.add(a.id); }
    const rest = keyed(of(s, (r) => r <= cap), k).filter((a) => !used.has(a.id));
    const loanQ = cap + 1 < C.order.length
      ? of(s, (r) => r === cap + 1).map((a) => ({ a, id: a.id, k: a.fee + k(a) / 10 })).sort(m.byK).map((o) => o.a) : [];
    for (let r = 0; r < 3; r++) {
      while (roles[r].filter((a) => a.s === s).length < per) {
        let a = rest.shift();
        if (!a) { a = loanQ.shift(); if (!a) throw new Error(`not enough ${s} actors for ${gid} at tier ${tier}`); loans.push(a.id); }
        roles[r].push(a);
      }
    }
  });
  const byFee = (a, b) => b.fee - a.fee || (a.id < b.id ? -1 : 1);
  return { pools: roles.map((x) => x.sort(byFee).map((a) => a.id)), loans };
}

// Director shortlist: up to `directors` from unlocked tiers, freshDirectors of them from the newest tier.
function crewList(C, key, gid, tier) {
  const m = C.m, sl = C.cfg.shortlist, cap = C.rank(tier);
  const keyed = (list) => list.map((d) => ({ d, id: d.id, k: m.seedOf("dirs", { day: key }, gid, d.id) - (m.inGenre(d.spec, gid) ? 0.35 : 0) })).sort(m.byK).map((o) => o.d);
  const fresh = keyed(m.DIRS.filter((d) => C.rank(C.dirTier[d.id]) === cap)).slice(0, sl.freshDirectors);
  const ids = new Set(fresh.map((d) => d.id));
  const rest = keyed(m.DIRS.filter((d) => C.rank(C.dirTier[d.id]) <= cap && !ids.has(d.id)));
  return fresh.concat(rest).slice(0, sl.directors).sort((a, b) => b.fee - a.fee || (a.id < b.id ? -1 : 1)).map((d) => d.id);
}

// Rebuild a stored project's env in the shape the model expects (Firestore can't hold nested arrays).
function projectEnv(pj) {
  const env = Object.assign({}, pj.env, { pools: {}, dirs: {} });
  Object.keys(pj.genres).forEach((g) => {
    const x = pj.genres[g];
    if (x.pools) { env.pools[g] = ROLES.map((r) => x.pools[r]); env.dirs[g] = x.dirs; }
  });
  return env;
}

// Does any film within budget clear the margin? The model's own bestPossible, run one director at a time
// (as bestPossibleAsync does) and stopped at the first director whose best film is good enough.
// Returns that film (the proof) or null.
function feasible(C, env, gid, cfg) {
  const m = C.m, margin = C.cfg.feasibility.margin;
  let best = null;
  for (const id of m.dirsFor(env, gid)) {
    best = m.bestPossible(env, gid, cfg, [m.D[id]], best);
    if (best && best.profit >= margin) return best;
  }
  return null;
}

// One project: deterministic from hash(uid, campaign id, project index), plus a salt that only moves when no
// genre at all could turn the margin. Every unlocked genre gets shortlists and is checked with bestPossible.
// `proofs` (tests only) collects the film that made each genre playable; it is never stored, since it would
// tell the player a good film.
function makeProject(C, st, uid, date, hard, proofs) {
  const m = C.m, f = C.cfg.feasibility, u = st.unlocked;
  const diff = hard && u.hard ? "hard" : st.filmsMade < C.cfg.trainingFilms ? "easy" : "medium";
  const budget = budgetFor(C, st);
  let pj;
  for (let salt = 0; salt <= f.maxResalts; salt++) {
    const key = projectKey(uid, st.campaignId, st.projectIndex, salt);
    const e = m.makeEnv(date, key);
    const env = { day: e.day, heat: e.heat, rival: e.rival, budget, plots: e.plots, dates: diff === "hard" ? e.dates : [], bonus: Object.assign({}, st.perks), disc: discounts(C, st), ident: identLean(C, st) };
    const genres = {}, loans = new Set();
    m.GENRES.forEach((g) => {
      if (!u.genres.includes(g.id)) { genres[g.id] = { state: "locked", at: genreUnlockAt(C, g.id) }; return; }
      const cp = castPools(C, key, g.id, u.actorTier);
      cp.loans.forEach((id) => loans.add(id));
      genres[g.id] = { state: "ok", pools: { a1: cp.pools[0], a2: cp.pools[1], a3: cp.pools[2] }, dirs: crewList(C, key, g.id, u.directorTier) };
    });
    pj = { index: st.projectIndex, salt, key, date, diff, budget, env, genres, loans: [...loans] };
    const full = projectEnv(pj);
    u.genres.forEach((g) => {
      const best = feasible(C, full, g, m.DIFFS[diff]);
      if (!best) { genres[g].state = "pricey"; delete genres[g].pools; delete genres[g].dirs; } else if (proofs) proofs[g] = best;
    });
    if (u.genres.some((g) => genres[g].state === "ok")) return pj;
  }
  throw new Error("no playable genre after " + f.maxResalts + " salts");
}

function newCampaign(C, uid, cid, name, date, now) {
  const s = C.cfg.start, u = unlocksFor(C, 0);
  const st = {
    studioName: cleanName(name) || defaultName(uid), renamed: false, createdAt: now, campaignId: cid,
    bank: s.bank, lifetimeProfit: 0, filmsMade: 0, bailouts: 0, lastProfit: null,
    unlocked: { actorTier: u.actorTier, directorTier: u.directorTier, genres: u.genres, hard: u.hard },
    gates: Object.fromEntries(u.gates.map((g) => [g, now])), badges: {}, perks: {}, genreHits: {}, stats: Object.assign({}, NEW_STATS, { seasons: [] }), profile: {},
    passesAvailable: C.cfg.pass.start, aTierFilms: null, projectIndex: 0, roster: C.game.version, recent: [],
    lifetimeGross: 0, upgrades: {},
  };
  st.currentProject = makeProject(C, st, uid, date, false);
  return st;
}

function defaultName(uid) { return "Studio " + uid.slice(0, 5).toUpperCase(); }
function cleanName(s) { return cleanText(s, 30); }

function checkIndex(st, index) {
  if (!st.currentProject || index !== st.currentProject.index) throw new Reject("That project is no longer current. Reload your studio.");
}

// Validate and score a film for the current project; returns the next state, the film record and events.
// ---- levels and upgrades. Experience is lifetime box office (every film counts, flops too); each level
// after the first gives one upgrade point. Upgrades reveal information (the page reads st.upgrades) or
// discount fees and marketing (env.disc, applied by the model's costOf).
function levelFor(C, gross) { return C.cfg.levels.filter((x) => gross >= x).length; }
function upgradeDef(C, id) { return C.cfg.upgrades.find((u) => u.id === id) || null; }
function pointsLeft(C, st) {
  const spent = C.cfg.upgrades.reduce((s, u) => s + (st.upgrades[u.id] || 0) * u.cost, 0);
  return levelFor(C, st.lifetimeGross) - 1 - spent;
}
// Fee and marketing discounts from upgrades, combined with the studio type's fees/marketing (a positive type
// value makes things dearer): the model charges fee * (1 - discount).
function discounts(C, st) {
  const out = {}, fx = typeEffects(C, st);
  let talent = 0, windows = 0;
  C.cfg.upgrades.forEach((u) => {
    const r = (st.upgrades || {})[u.id] || 0;
    if (r && u.talent) talent = u.talent[r - 1];
    if (r && u.windows) windows = u.windows[r - 1];
  });
  const t = 1 - (1 - talent) * (1 + (fx.fees || 0)), w = 1 - (1 - windows) * (1 + (fx.marketing || 0));
  if (Math.abs(t) > 1e-9) out.talent = Math.round(t * 10000) / 10000;
  if (Math.abs(w) > 1e-9) out.windows = Math.round(w * 10000) / 10000;
  return out;
}

// ---- studio type (onboarding, data/identity.json): four answers add points to five types; the type with the
// most wins (ties go to the type the risk answer favours, then file order). Its effects lean genres (env.ident),
// change fees, marketing and the budget cap, and move the breakout threshold. Chosen once.
function typeFor(C, answers) {
  const pts = Object.fromEntries(C.idn.types.map((t) => [t.id, 0]));
  answers.forEach((a) => Object.entries(a.points).forEach(([t, v]) => { if (own(pts, t)) pts[t] += v; }));
  const risk = answers[answers.length - 1].points;
  return C.idn.types.map((t) => t.id).sort((x, y) => pts[y] - pts[x] || (risk[y] || 0) - (risk[x] || 0))[0];
}
function typeEffects(C, st) {
  const id = st.identity && st.identity.type, t = id && C.idn.types.find((x) => x.id === id);
  return (t && t.effects) || {};
}
// Genre lean per genre id; a blend gets the average of its halves.
function identLean(C, st) {
  const lean = typeEffects(C, st).genres || {}, out = {};
  C.m.GENRES.forEach((g) => {
    const parts = g.mix || [g.id], v = parts.reduce((s, x) => s + (lean[x] || 0), 0) / parts.length;
    if (v) out[g.id] = Math.round(v * 10000) / 10000;
  });
  return out;
}
function identity(C, st, uid, input) {
  st = normalize(st);
  if (st.identity) throw new Reject("Your studio type is already set.");
  const ids = input && input.answers, qs = C.idn.questions;
  if (!Array.isArray(ids) || ids.length !== qs.length) throw new Reject("Answer every question first.");
  const answers = qs.map((q, i) => {
    const a = typeof ids[i] === "string" && q.answers.find((x) => x.id === ids[i]);
    if (!a) throw new Reject("That isn't one of the answers.");
    return a;
  });
  const next = Object.assign({}, st, { identity: { type: typeFor(C, answers), answers: answers.map((a) => a.id) } });
  next.currentProject = makeProject(C, next, uid, st.currentProject.date, st.currentProject.diff === "hard");
  return next;
}

// ---- breakouts: a film that makes at least `threshold` of the best film its project allowed (in that genre)
// spins a weighted roulette (data/campaign.json breakout.wheel), seeded by the project and the exact film so it
// can't be re-spun. The multiplier is a Breakout step in the model (env.boom).
function breakoutFor(C, st, pj, env, p, cfg, r) {
  const m = C.m, b = C.cfg.breakout;
  if (!b || r.profit <= 0) return null;
  const best = m.bestPossible(env, p.g, cfg);
  if (!best || best.profit <= 0) return null;
  const need = b.threshold + (typeEffects(C, st).breakout || 0), share = r.profit / best.profit;
  if (share < need - 1e-9) return null;
  const total = b.wheel.reduce((s, x) => s + x.w, 0);
  let roll = m.rng(m.hash(pj.key + "|boom|" + [p.g, p.d, p.a1, p.a2, p.a3, p.w].join("|")))() * total, slot = 0;
  while (slot < b.wheel.length - 1 && roll >= b.wheel[slot].w) { roll -= b.wheel[slot].w; slot++; }
  return { x: b.wheel[slot].x, slot, share: Math.round(share * 1000) / 1000, need: Math.round(need * 1000) / 1000, best: round1(best.profit) };
}
// Studios founded before levels, stats or tiered badges existed get the new fields (an old badge was a bare
// timestamp; it becomes tier 1).
const NEW_STATS = { streak: 0, reunions: 0, chemistry: 0, timing: 0, seasons: [], realHits: 0, bailedOut: false, breakouts: 0 };
function normalize(st) {
  const out = Object.assign({ lifetimeGross: 0, upgrades: {}, profile: {}, identity: null }, st);
  out.stats = Object.assign({}, NEW_STATS, st.stats, { seasons: ((st.stats || {}).seasons || []).slice() });
  out.badges = Object.fromEntries(Object.entries(st.badges || {}).map(([k, v]) => [k, typeof v === "number" ? { tier: 1, at: v } : v]));
  // Studios from before the public card: their best film so far is the biggest of their recent ones.
  if (out.bestFilm === undefined) out.bestFilm = (st.recent || []).reduce((b, f) => (!b || f.gross > b.gross ? { title: f.title, genre: f.genre, gross: f.gross, profit: f.profit, no: f.no } : b), null);
  return out;
}

// The studio's public card (studios/{uid}): what other players see when they click it on a board. Only the look,
// progress, badge tiers and the highest-grossing film; never the bank, the current project or private history.
function publicStudio(C, uid, st, now) {
  const pr = st.profile || {};
  return {
    uid, studioName: st.studioName, level: levelFor(C, st.lifetimeGross || 0), filmsMade: st.filmsMade,
    lifetimeGross: st.lifetimeGross || 0, lifetimeProfit: st.lifetimeProfit, aTierFilms: st.aTierFilms,
    profile: { color: pr.color || null, tagline: pr.tagline || "", city: pr.city || "", logo: pr.logo || null, backdrop: pr.backdrop || null },
    badges: Object.fromEntries(Object.entries(st.badges || {}).map(([k, v]) => [k, typeof v === "number" ? 1 : v.tier])),
    bestFilm: st.bestFilm || null, type: (st.identity && st.identity.type) || null, updatedAt: now,
  };
}

// Buy the next rank of an upgrade with points. A discount takes effect on the current project at once
// (same seed, same pitches and shortlists; only the fees change).
function upgrade(C, st, uid, input, now) {
  st = normalize(st);
  const u = upgradeDef(C, input && input.id);
  if (!u) throw new Reject("Unknown upgrade.");
  const have = st.upgrades[u.id] || 0, level = levelFor(C, st.lifetimeGross);
  if (have >= u.ranks.length) throw new Reject("That upgrade is already maxed out.");
  if (u.minLevel && level < u.minLevel) throw new Reject(`${u.name} needs studio level ${u.minLevel}.`);
  if (pointsLeft(C, st) < u.cost) throw new Reject("Not enough upgrade points. You earn one per studio level.");
  const next = Object.assign({}, st, { upgrades: Object.assign({}, st.upgrades, { [u.id]: have + 1 }), badges: Object.assign({}, st.badges) });
  if (u.talent || u.windows) next.currentProject = makeProject(C, next, uid, st.currentProject.date, st.currentProject.diff === "hard");
  return { state: next, badges: awardBadges(C, st, next, null, now || 0) };
}

function release(C, st, uid, input, date, now) {
  st = normalize(st);
  const m = C.m, pj = st.currentProject, { pick } = input || {};
  checkIndex(st, input && input.index);
  if (!pick || typeof pick !== "object") throw new Reject("No film in the request.");
  const { g, d, a1, a2, a3, w } = pick;
  if (!own(pj.genres, g)) throw new Reject("Unknown genre.");
  const gs = pj.genres[g];
  if (gs.state !== "ok") throw new Reject(gs.state === "locked" ? "Your studio hasn't unlocked that genre yet." : "That genre is too pricey for this project.");
  if (!gs.dirs.includes(d)) throw new Reject("That director isn't on this project's shortlist.");
  if (!gs.pools.a1.includes(a1) || !gs.pools.a2.includes(a2) || !gs.pools.a3.includes(a3)) throw new Reject("Someone in that cast isn't on this project's shortlist for their part.");
  const cfg = m.DIFFS[pj.diff];
  if (cfg.real ? !pj.env.dates.includes(w) : !(own(m.W, w) && !m.W[w].hardOnly)) throw new Reject("That release slot isn't available.");
  const p = { g, d, a1, a2, a3, w }, env = projectEnv(pj);
  if (m.costOf(p, cfg, env) > pj.budget) throw new Reject("That film is over this project's budget.");
  let r = m.evalFilm(env, p, cfg);
  const boom = breakoutFor(C, st, pj, env, p, cfg, r);
  if (boom) { env.boom = { [g]: boom.x }; r = m.evalFilm(env, p, cfg); }
  const profit = round1(r.profit);

  const before = st, B = C.badges, lifetime = round1(st.lifetimeProfit + Math.max(0, profit));
  const money = settle(C, st.bank + profit);
  const filmsMade = st.filmsMade + 1;
  const u0 = unlocksFor(C, st.lifetimeProfit, st.gates), u = unlocksFor(C, lifetime, st.gates);
  const newGates = u.gates.filter((x) => !u0.gates.includes(x));
  const next = Object.assign({}, st, {
    bank: money.bank, lifetimeProfit: lifetime, filmsMade, bailouts: st.bailouts + (money.bailout ? 1 : 0), lastProfit: profit,
    unlocked: { actorTier: u.actorTier, directorTier: u.directorTier, genres: u.genres, hard: u.hard },
    gates: Object.assign({}, st.gates), badges: Object.assign({}, st.badges), perks: Object.assign({}, st.perks),
    genreHits: Object.assign({}, st.genreHits), projectIndex: st.projectIndex + 1,
    lifetimeGross: Math.round(st.lifetimeGross + r.gross), stats: Object.assign({}, st.stats, { seasons: st.stats.seasons.slice() }),
  });
  const lv0 = levelFor(C, st.lifetimeGross), lv1 = levelFor(C, next.lifetimeGross);
  newGates.forEach((x) => { next.gates[x] = now; });
  if (filmsMade % C.cfg.pass.every === 0) next.passesAvailable = Math.min(C.cfg.pass.cap, st.passesAvailable + 1);
  if (profit > 0) next.genreHits[g] = (st.genreHits[g] || 0) + 1;
  // Genre Master perk: the genre's films earn more from now on.
  const perks = profit > 0 && next.genreHits[g] >= B.genre_master.films && !own(st.perks, g) ? [g] : [];
  perks.forEach((x) => { next.perks[x] = B.genre_master.bonus; });
  const facts = Object.assign(filmFacts(C, before, { p, cfg, env, profit }), { boom });
  updateStats(next.stats, facts, money.bailout);
  let board = null;
  if (newGates.includes(C.cfg.boardGoal) && next.aTierFilms === null) {
    next.aTierFilms = filmsMade;
    board = { displayName: st.studioName, filmsToATier: filmsMade, bailouts: next.bailouts, lifetimeProfit: lifetime, reachedAt: now,
      logo: st.profile.logo || null, color: st.profile.color || null };
  }
  const badges = awardBadges(C, before, next, { p, r, profit, budget: pj.budget, facts }, now);
  next.currentProject = makeProject(C, next, uid, date, false);
  const film = {
    no: filmsMade, projectIndex: pj.index, title: m.plotFor(env, g).title, genre: g, pick: p, diff: pj.diff,
    profit, gross: Math.round(r.gross), cost: r.cost, budget: pj.budget, badges, perks,
    gates: newGates, bailout: money.bailout, at: now,
    script: pj.script && pj.script.g === g ? { s: pj.script.s, q: m.scriptQ(env, g), items: pj.script.items } : null,
    breakout: boom,
  };
  // Highest-grossing film so far, for the public studio card.
  if (!st.bestFilm || film.gross > st.bestFilm.gross) {
    next.bestFilm = { title: film.title, genre: g, gross: film.gross, profit, no: filmsMade, d: p.d, cast: [p.a1, p.a2, p.a3], boom: boom ? boom.x : null };
  }
  // The last few films ride along in the studio doc so the HQ needs no extra reads.
  next.recent = [{ no: filmsMade, title: film.title, genre: g, profit, gross: film.gross, at: now }].concat(st.recent || []).slice(0, C.cfg.recentFilms || 5);
  const events = { gates: newGates.map((id) => C.cfg.ladder.find((s) => s.id === id)), badges, perks, bailout: money.bailout, breakout: boom,
    level: lv1 > lv0 ? { from: lv0, to: lv1, points: pointsLeft(C, next) } : null };
  return { state: next, film, events, board };
}

// ---- achievements. Each badge has a value (from this film or the studio's running stats) and tiers from
// data/achievements.json (one tier when it lists none). A badge is stored as { tier, at } and fires again
// only when a higher tier is reached.
function filmFacts(C, before, { p, cfg, env, profit }) {
  const m = C.m, cast = [p.a1, p.a2, p.a3];
  let chem = false;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (m.CHEM.some((c) => m.pairKey(c[0], c[1]) === m.pairKey(cast[i], cast[j]))) chem = true;
  return {
    hit: profit > 0, cast, chem,
    reunion: m.LOYAL.some((l) => l[0] === p.d && cast.includes(l[1])),
    timing: m.plotFor(env, p.g).win.includes(m.winId(p, cfg)),
    season: m.winId(p, cfg),
    real: !!cfg.real,
    synergy: m.synergies(env, p, cfg).reduce((s, x) => s + x[1], 0),
    afterFlop: before.lastProfit !== null && before.lastProfit < 0,
    afterBailout: !!before.stats.bailedOut,
  };
}
function updateStats(s, f, bailout) {
  s.streak = f.hit ? s.streak + 1 : 0;
  if (f.reunion) s.reunions++;
  if (f.chem) s.chemistry++;
  if (f.timing) s.timing++;
  if (f.hit && !s.seasons.includes(f.season)) s.seasons.push(f.season);
  if (f.hit && f.real) s.realHits++;
  if (f.boom) s.breakouts = (s.breakouts || 0) + 1;
  s.bailedOut = bailout;
}
// film is null when the change isn't a release (an upgrade): then only badges that need no film are checked.
function badgeValue(C, id, before, st, film) {
  const B = C.badges, s = st.stats, f = film && film.facts;
  const studio = {
    box_office: st.lifetimeGross, prolific: st.filmsMade, genre_master: Object.keys(st.perks).length,
    genre_explorer: Object.values(st.genreHits).filter((n) => n > 0).length,
    well_equipped: Object.values(st.upgrades || {}).reduce((a, x) => a + x, 0),
    hit_streak: s.streak, reunion: s.reunions, chemistry: s.chemistry, perfect_timing: s.timing,
    year_round: s.seasons.length, opening_weekend: s.realHits, breakout: s.breakouts || 0,
    iron_studio: st.aTierFilms !== null && st.bailouts === 0 ? 1 : 0, fast_track: st.aTierFilms,
  };
  if (own(studio, id)) return studio[id];
  if (!film) return undefined;
  const { p, r, profit, budget } = film;
  return {
    first_hit: f.hit ? 1 : 0,
    blockbuster: profit,
    sleeper_hit: profit >= B.sleeper_hit.profit && r.cost <= B.sleeper_hit.costShare * budget ? 1 : 0,
    comeback: f.hit && f.afterFlop ? 1 : 0,
    full_house: f.hit && C.rank(before.unlocked.actorTier) >= C.rank(B.full_house.after) &&
      C.dirTier[p.d] === B.full_house.tier && f.cast.every((a) => C.actorTier[a] === B.full_house.tier) ? 1 : 0,
    in_sync: f.synergy,
    jackpot: f.boom && f.boom.slot === C.cfg.breakout.wheel.length - 1 ? 1 : 0,
    phoenix: f.hit && f.afterBailout ? 1 : 0,
  }[id];
}
function tierFor(b, v) {
  if (v === undefined || v === null) return 0;
  return (b.tiers || [1]).filter((t) => (b.atMost ? v <= t : v >= t - 1e-9)).length;
}
// Records newly reached tiers on next.badges and returns them as [{ id, tier }].
function awardBadges(C, before, next, film, now) {
  const out = [];
  C.ach.badges.forEach((b) => {
    const tier = tierFor(b, badgeValue(C, b.id, before, next, film)), have = (next.badges[b.id] || {}).tier || 0;
    if (tier > have) { next.badges[b.id] = { tier, at: now }; out.push({ id: b.id, tier }); }
  });
  return out;
}

// Story rerolls: from the studio levels in data/campaign.json `rerolls`, a number per project. A reroll lays out
// three scripts for one playable genre (scriptOffer, seeded by the project and the reroll count so it can't be
// fished for): one strong draft, one middling, one weak. Drafts with no film over the feasibility margin are
// marked unavailable. The player then takes one with pickScript; the project keeps the offer for the result.
function rerollsFor(C, st) {
  const lv = levelFor(C, st.lifetimeGross);
  return (C.cfg.rerolls || []).reduce((n, r) => (lv >= r.level ? r.count : n), 0);
}
function reroll(C, st, uid, input) {
  st = normalize(st);
  checkIndex(st, input && input.index);
  const m = C.m, pj = st.currentProject, g = input.g, allowed = rerollsFor(C, st), used = pj.rerolls || 0;
  if (!allowed) throw new Reject(`Story rerolls unlock at studio level ${C.cfg.rerolls[0].level}.`);
  if (used >= allowed) throw new Reject("No story rerolls left on this project.");
  if (!own(pj.genres, g) || pj.genres[g].state !== "ok") throw new Reject("You can only reroll the story of a playable genre.");
  const env0 = projectEnv(pj), cfg = m.DIFFS[pj.diff];
  const items = m.scriptOffer(pj.key + "|offer|" + g + "|" + used, m.plotChoices(pj.date, g))
    .map((x) => ({ s: x.s, q: x.q, ok: !!feasible(C, m.envWithScript(env0, g, x.s, x.q), g, cfg) }));
  if (!items.some((x) => x.ok)) throw new Reject("No script for that genre works within this budget.");
  return Object.assign({}, st, { currentProject: Object.assign({}, pj, { rerolls: used + 1, offer: { g, items } }) });
}
function pickScript(C, st, uid, input) {
  st = normalize(st);
  checkIndex(st, input && input.index);
  const pj = st.currentProject, o = pj.offer, x = input || {};
  if (!o || o.g !== x.g) throw new Reject("There's no script offer for that genre. Reroll first.");
  const item = o.items.find((it) => it.s === x.s);
  if (!item || !item.ok) throw new Reject("That script isn't one you can pick.");
  const env = Object.assign({}, pj.env, { plots: Object.assign({}, pj.env.plots, { [o.g]: item.s }), quality: Object.assign({}, pj.env.quality, { [o.g]: item.q }) });
  return Object.assign({}, st, { currentProject: Object.assign({}, pj, { env, offer: null, script: { g: o.g, s: item.s, items: o.items } }) });
}

// Skip the current pitches: costs the development fee, uses a pass, moves to the next project index.
function pass(C, st, uid, input, date) {
  st = normalize(st);
  checkIndex(st, input && input.index);
  if (st.passesAvailable < 1) throw new Reject("No passes left. You earn one every " + C.cfg.pass.every + " films.");
  const money = settle(C, st.bank - C.cfg.pass.fee);
  const next = Object.assign({}, st, {
    bank: money.bank, bailouts: st.bailouts + (money.bailout ? 1 : 0),
    passesAvailable: st.passesAvailable - 1, projectIndex: st.projectIndex + 1,
  });
  next.currentProject = makeProject(C, next, uid, date, false);
  return { state: next, events: { bailout: money.bailout, fee: C.cfg.pass.fee } };
}

// Switch the current project to real release dates (once the hard gate is open) or back. Same seed, so the
// market and pitches stay; only the release step changes.
function setHard(C, st, uid, input) {
  st = normalize(st);
  checkIndex(st, input && input.index);
  const hard = !!input.hard;
  if (hard && !st.unlocked.hard) throw new Reject("Real release dates unlock with the A-list.");
  if ((st.currentProject.diff === "hard") === hard) return st;
  return Object.assign({}, st, { currentProject: makeProject(C, st, uid, st.currentProject.date, hard) });
}

// Studio look: colour (from the palette in data/campaign.json), tagline, city, and the versions of the logo and
// backdrop images. The store checks the images in Storage first and passes their versions (or null to remove).
function cleanText(s, max) { return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
function style(C, st, input, images) {
  st = normalize(st);
  const P = C.cfg.profile, prof = Object.assign({}, st.profile), x = input || {};
  if (x.color !== undefined) {
    if (!C.cfg.studioColors.some((c) => c.id === x.color)) throw new Reject("Unknown studio colour.");
    prof.color = x.color;
  }
  if (x.tagline !== undefined) prof.tagline = cleanText(x.tagline, P.taglineMax);
  if (x.city !== undefined) prof.city = cleanText(x.city, P.cityMax);
  ["logo", "backdrop"].forEach((k) => { if (images && own(images, k)) prof[k] = images[k]; });
  return Object.assign({}, st, { profile: prof });
}

function rename(st, name) {
  if (st.renamed) throw new Reject("The studio has already been renamed once.");
  const n = cleanName(name);
  if (n.length < 2) throw new Reject("Pick a studio name of 2 to 30 characters.");
  return Object.assign({}, st, { studioName: n, renamed: true });
}

module.exports = {
  loadCampaign, makeCampaign, unlocksFor, nextGate, budgetFor, settle, castPools, crewList, projectEnv,
  makeProject, feasible, awardBadges, badgeValue, tierFor, filmFacts, newCampaign, release, pass, setHard, rename, defaultName, cleanName, projectKey,
  levelFor, pointsLeft, discounts, upgrade, normalize, style, rerollsFor, reroll, pickScript, publicStudio,
  identity, typeFor, typeEffects, identLean, breakoutFor,
};
