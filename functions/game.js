// Server-side game check. Never trusts the client: it rebuilds the day from the date, confirms every pick was
// really on that day's shortlists and within budget, then scores the film with the same model code the page
// runs (copied into gen/ by tools/build_functions.mjs), so results match the page bit-for-bit.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FILES = ["genres", "directors", "actors", "plots", "windows", "loyal", "chem", "slate"];

function loadGame(dir = path.join(__dirname, "gen")) {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(dir, "model.js"), "utf8"), ctx, { filename: "model.js" });
  const data = Object.fromEntries(FILES.map((n) => [n, JSON.parse(fs.readFileSync(path.join(dir, "data", n + ".json"), "utf8"))]));
  ctx.initModel(data);
  const vf = path.join(dir, "VERSION");
  return { m: ctx, version: fs.existsSync(vf) ? fs.readFileSync(vf, "utf8").trim() : "dev" };
}

class Reject extends Error {}
const own = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);

// input: { type: "basic" | "daily", diff: "easy" | "medium" | "hard", day: "YYYY-MM-DD", pick: { g, d, a1, a2, a3, w } }
function check(game, input, now = Date.now()) {
  const m = game.m;
  const { type, diff, day, pick } = input || {};
  if (type !== "basic" && type !== "daily") throw new Reject("Unknown game mode.");
  if (!own(m.DIFFS, diff)) throw new Reject("Unknown difficulty.");
  if (type === "daily" && diff !== "hard") throw new Reject("The Daily Challenge is always played on Hard.");
  // The puzzle day is the UTC date. Yesterday is still accepted so a film started just before midnight UTC counts.
  const today = utcDay(now);
  if (day !== today && day !== m.addDays(today, -1)) throw new Reject("That day's puzzle is closed. Reload to play today's.");
  if (!pick || typeof pick !== "object") throw new Reject("No film in the request.");
  const { g, d, a1, a2, a3, w } = pick;

  const env = m.makeEnv(day), cfg = m.DIFFS[diff];
  if (!own(m.G, g)) throw new Reject("Unknown genre.");
  if (type === "daily" && g !== env.daily) throw new Reject("That isn't today's Daily Challenge genre.");
  if (!m.dirsFor(env, g).includes(d)) throw new Reject("That director isn't on today's shortlist.");
  const pools = m.poolsFor(env, g);
  if (!pools[0].includes(a1) || !pools[1].includes(a2) || !pools[2].includes(a3)) throw new Reject("Someone in that cast isn't on today's shortlist for their part.");
  if (cfg.real ? !env.dates.includes(w) : !(own(m.W, w) && !m.W[w].hardOnly)) throw new Reject("That release slot isn't available.");

  const p = { g, d, a1, a2, a3, w };
  const cost = m.costOf(p, cfg);
  if (cost > env.budget) throw new Reject("That film is over today's budget.");
  const r = m.evalFilm(env, p, cfg);
  return {
    board: `r3-${type}-${diff}_${day}`, type, diff, day, p,
    title: m.plotFor(env, g).title, profit: r.profit, gross: r.gross, cost: r.cost,
  };
}

module.exports = { loadGame, check, Reject, utcDay };
