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
// Table-read answers: two option indexes (0-2). Anything else counts as not answered.
function cleanNotes(x) {
  return Array.isArray(x) && x.length === 2 && x.every((v) => Number.isInteger(v) && v >= 0 && v <= 2) ? [x[0], x[1]] : null;
}
const own = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);

// input: { type: "basic" | "daily", diff: "easy" | "medium" | "hard", day: "YYYY-MM-DD", pick: { g, d, a1, a2, a3, w, s?, n? } }
// Basic players can swap the story: n is the script offer they picked from (basicOffer(day, g, n), rebuilt here
// from the same seed) and s the script in it, scored with that draft's potential. s without n (older pages)
// is any of the genre's pitches for the day at ×1. The Daily Challenge always uses the day's shared story.
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
  const { g, d, a1, a2, a3, w, s, n } = pick;
  const notes = cleanNotes(pick.notes);

  let env = m.makeEnv(day);
  const cfg = m.DIFFS[diff];
  if (!own(m.G, g)) throw new Reject("Unknown genre.");
  if (type === "daily" && g !== env.daily) throw new Reject("That isn't today's Daily Challenge genre.");
  if (n !== undefined && n !== null) {
    if (type === "daily") throw new Reject("The Daily Challenge uses today's shared story.");
    if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Reject("That script offer isn't valid.");
    const item = m.basicOffer(day, g, n).find((x) => x.s === s);
    if (!item) throw new Reject("That script wasn't in that offer.");
    env = m.envWithScript(env, g, item.s, item.q);
  } else if (s !== undefined && s !== null && s !== env.plots[g]) {
    if (type === "daily") throw new Reject("The Daily Challenge uses today's shared story.");
    if (!Number.isInteger(s) || !m.plotChoices(day, g).includes(s)) throw new Reject("That story isn't available for this genre today.");
    env = m.envWithPlot(env, g, s);
  }
  if (!m.dirsFor(env, g).includes(d)) throw new Reject("That director isn't on today's shortlist.");
  const pools = m.poolsFor(env, g);
  if (!pools[0].includes(a1) || !pools[1].includes(a2) || !pools[2].includes(a3)) throw new Reject("Someone in that cast isn't on today's shortlist for their part.");
  if (cfg.real ? !env.dates.includes(w) : !(own(m.W, w) && !m.W[w].hardOnly)) throw new Reject("That release slot isn't available.");

  const p = { g, d, a1, a2, a3, w, s: env.plots[g], q: m.scriptQ(env, g), n: Number.isInteger(n) ? n : null };
  if (notes) p.notes = notes;
  const cost = m.costOf(p, cfg);
  if (cost > env.budget) throw new Reject("That film is over today's budget.");
  const r = m.evalFilm(env, p, cfg);
  return {
    board: `r3-${type}-${diff}_${day}`, type, diff, day, p,
    title: m.plotFor(env, g).title, profit: r.profit, gross: r.gross, cost: r.cost,
  };
}

// The public name on the daily boards: only a name the player typed as their studio name at email sign-up.
// Google accounts carry the person's real name, so they show as "Studio XXXXX" instead. Photos are never kept.
function boardName(uid, tok) {
  const t = tok || {}, typed = (t.firebase || {}).sign_in_provider === "password" && typeof t.name === "string"
    ? t.name.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 30) : "";
  return typed || "Studio " + uid.slice(0, 5).toUpperCase();
}

module.exports = { loadGame, check, Reject, utcDay, boardName, cleanNotes };
