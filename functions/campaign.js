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
  return makeCampaign(game, rd("campaign"), rd("achievements"));
}

// Tiers are derived from stats: the highest tier whose minimum the person meets.
function makeCampaign(game, cfg, ach) {
  const m = game.m, order = cfg.tiers.order;
  const tierOf = (v, mins) => order.reduce((t, x) => (v >= mins[x] - 1e-9 ? x : t), order[0]);
  const actorTier = {}, dirTier = {};
  m.ACTORS.forEach((a) => { actorTier[a.id] = tierOf(a.star, cfg.tiers.actorMinStar); });
  m.DIRS.forEach((d) => { dirTier[d.id] = tierOf(d.skill, cfg.tiers.directorMinSkill); });
  const badges = Object.fromEntries(ach.badges.map((b) => [b.id, b]));
  return { game, m, cfg, ach, badges, order, rank: (t) => order.indexOf(t), actorTier, dirTier };
}

// What a lifetime profit has unlocked: the last tier each ladder step names, every genre named so far.
function unlocksFor(C, lifetime) {
  const u = { actorTier: C.order[0], directorTier: C.order[0], genres: [], hard: false, gates: [] };
  C.cfg.ladder.forEach((s) => {
    if (lifetime < s.at) return;
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
  return Math.min(C.cfg.caps[top], Math.max(C.cfg.start.floor, st.bank));
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
    const env = { day: e.day, heat: e.heat, rival: e.rival, budget, plots: e.plots, dates: diff === "hard" ? e.dates : [], bonus: Object.assign({}, st.perks) };
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
    gates: Object.fromEntries(u.gates.map((g) => [g, now])), badges: {}, perks: {}, genreHits: {},
    passesAvailable: C.cfg.pass.start, aTierFilms: null, projectIndex: 0, roster: C.game.version,
  };
  st.currentProject = makeProject(C, st, uid, date, false);
  return st;
}

function defaultName(uid) { return "Studio " + uid.slice(0, 5).toUpperCase(); }
function cleanName(s) { return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 30) : ""; }

function checkIndex(st, index) {
  if (!st.currentProject || index !== st.currentProject.index) throw new Reject("That project is no longer current. Reload your studio.");
}

// Validate and score a film for the current project; returns the next state, the film record and events.
function release(C, st, uid, input, date, now) {
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
  if (m.costOf(p, cfg) > pj.budget) throw new Reject("That film is over this project's budget.");
  const r = m.evalFilm(env, p, cfg), profit = round1(r.profit);

  const before = st, lifetime = round1(st.lifetimeProfit + Math.max(0, profit));
  const money = settle(C, st.bank + profit);
  const filmsMade = st.filmsMade + 1;
  const u0 = unlocksFor(C, st.lifetimeProfit), u = unlocksFor(C, lifetime);
  const newGates = u.gates.filter((x) => !u0.gates.includes(x));
  const next = Object.assign({}, st, {
    bank: money.bank, lifetimeProfit: lifetime, filmsMade, bailouts: st.bailouts + (money.bailout ? 1 : 0), lastProfit: profit,
    unlocked: { actorTier: u.actorTier, directorTier: u.directorTier, genres: u.genres, hard: u.hard },
    gates: Object.assign({}, st.gates), badges: Object.assign({}, st.badges), perks: Object.assign({}, st.perks),
    genreHits: Object.assign({}, st.genreHits), projectIndex: st.projectIndex + 1,
  });
  newGates.forEach((x) => { next.gates[x] = now; });
  if (filmsMade % C.cfg.pass.every === 0) next.passesAvailable = Math.min(C.cfg.pass.cap, st.passesAvailable + 1);
  if (profit > 0) next.genreHits[g] = (st.genreHits[g] || 0) + 1;
  const ev = badgeEvents(C, before, next, { p, cfg, env, r, profit, budget: pj.budget });
  ev.badges.forEach((b) => { next.badges[b] = now; });
  ev.perks.forEach((x) => { next.perks[x] = C.badges.genre_master.bonus; });
  let board = null;
  if (newGates.includes(C.cfg.boardGoal) && next.aTierFilms === null) {
    next.aTierFilms = filmsMade;
    board = { displayName: st.studioName, filmsToATier: filmsMade, bailouts: next.bailouts, lifetimeProfit: lifetime, reachedAt: now };
  }
  next.currentProject = makeProject(C, next, uid, date, false);
  const film = {
    no: filmsMade, projectIndex: pj.index, title: m.plotFor(env, g).title, genre: g, pick: p, diff: pj.diff,
    profit, gross: Math.round(r.gross), cost: r.cost, budget: pj.budget, badges: ev.badges, perks: ev.perks,
    gates: newGates, bailout: money.bailout, at: now,
  };
  const events = { gates: newGates.map((id) => C.cfg.ladder.find((s) => s.id === id)), badges: ev.badges, perks: ev.perks, bailout: money.bailout };
  return { state: next, film, events, board };
}

// Badges earned by this film. `before` is the state going in, `next` the state coming out.
function badgeEvents(C, before, next, f) {
  const m = C.m, B = C.badges, { p, cfg, env, r, profit, budget } = f, hit = profit > 0, out = [];
  const people = [p.a1, p.a2, p.a3];
  const test = {
    first_hit: hit,
    blockbuster: profit >= B.blockbuster.profit,
    sleeper_hit: profit >= B.sleeper_hit.profit && r.cost <= B.sleeper_hit.costShare * budget,
    reunion: m.LOYAL.some((l) => l[0] === p.d && people.includes(l[1])),
    comeback: hit && before.lastProfit !== null && before.lastProfit < 0,
    genre_master: hit && next.genreHits[p.g] >= B.genre_master.films,
    full_house: hit && C.rank(before.unlocked.actorTier) >= C.rank(B.full_house.after) &&
      C.dirTier[p.d] === B.full_house.tier && people.every((a) => C.actorTier[a] === B.full_house.tier),
    perfect_timing: m.plotFor(env, p.g).win.includes(m.winId(p, cfg)),
  };
  Object.keys(test).forEach((id) => { if (test[id] && B[id] && !own(before.badges, id)) out.push(id); });
  const perks = test.genre_master && !own(before.perks, p.g) ? [p.g] : [];
  return { badges: out, perks };
}

// Skip the current pitches: costs the development fee, uses a pass, moves to the next project index.
function pass(C, st, uid, input, date) {
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
function setHard(C, st, uid, input, date) {
  checkIndex(st, input && input.index);
  const hard = !!input.hard;
  if (hard && !st.unlocked.hard) throw new Reject("Real release dates unlock with the A-list.");
  if ((st.currentProject.diff === "hard") === hard) return st;
  return Object.assign({}, st, { currentProject: makeProject(C, st, uid, date, hard) });
}

function rename(st, name) {
  if (st.renamed) throw new Reject("The studio has already been renamed once.");
  const n = cleanName(name);
  if (n.length < 2) throw new Reject("Pick a studio name of 2 to 30 characters.");
  return Object.assign({}, st, { studioName: n, renamed: true });
}

module.exports = {
  loadCampaign, makeCampaign, unlocksFor, nextGate, budgetFor, settle, castPools, crewList, projectEnv,
  makeProject, feasible, badgeEvents, newCampaign, release, pass, setHard, rename, defaultName, cleanName, projectKey,
};
