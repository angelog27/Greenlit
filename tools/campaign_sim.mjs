// Campaign pacing simulation. Plays whole campaigns through the real server rules (functions/campaign.js:
// project generation, feasibility gate, release, bailouts, unlocks) with two policies:
//   random  a uniformly random valid film within budget
//   decent  simple fit rules a player can see without hidden numbers: genre by potential minus cost, a
//           director who specialises in the genre and gets the story's tone, actors who fit the genre and
//           their part's tone (plus reunions and chemistry), a window the story suits; cheaper picks when over
// Reports how many films it takes to reach each unlock and how often studios get bailed out.
//   node tools/campaign_sim.mjs [--runs 40] [--films 80] [--config data/campaign.json] [--workers 10]
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";

const require = createRequire(import.meta.url);
const ROOT = new URL("../", import.meta.url);

function simulate({ cfg, ach, policy, run, films }) {
  const { loadGame } = require("../functions/game.js");
  const camp = require("../functions/campaign.js");
  const game = loadGame(), C = camp.makeCampaign(game, cfg, ach), m = C.m;
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const uid = `sim-${policy}-${run}`, DATE = "2026-10-20";
  const r = m.rng(m.hash(uid));
  const any = (a) => a[Math.floor(r() * a.length)];
  let st = plain(camp.newCampaign(C, uid, "c" + run, "", DATE, 0));
  const reached = {}, profits = [];
  for (let n = 1; n <= films; n++) {
    const pj = st.currentProject, dcfg = m.DIFFS[pj.diff], env = camp.projectEnv(pj);
    const pick = (policy === "random" ? randomPick : decentPick)(m, pj, env, dcfg, any);
    const out = plain(camp.release(C, st, uid, { index: pj.index, pick }, DATE, n));
    profits.push(out.film.profit);
    out.events.gates.forEach((g) => { reached[g.id] = n; });
    st = out.state;
    if (reached[cfg.boardGoal]) break;
  }
  return { policy, run, reached, bailouts: st.bailouts, films: profits.length, profits, lifetime: st.lifetimeProfit };
}

function windowsOf(m, pj, dcfg) { return dcfg.real ? pj.env.dates : m.WINDOWS.filter((w) => !w.hardOnly).map((w) => w.id); }

function randomPick(m, pj, env, dcfg, any) {
  const ok = Object.keys(pj.genres).filter((g) => pj.genres[g].state === "ok");
  for (let i = 0; i < 400; i++) {
    const g = any(ok), gs = pj.genres[g];
    const p = { g, d: any(gs.dirs), a1: any(gs.pools.a1), a2: any(gs.pools.a2), a3: any(gs.pools.a3), w: any(windowsOf(m, pj, dcfg)) };
    if (m.costOf(p, dcfg) <= pj.budget) return p;
  }
  return cheapest(m, pj, any(ok), dcfg);
}

function cheapest(m, pj, g, dcfg) {
  const gs = pj.genres[g], lo = (ids, M) => ids.slice().sort((a, b) => M[a].fee - M[b].fee)[0];
  const w = windowsOf(m, pj, dcfg).slice().sort((a, b) => m.W[dcfg.real ? m.seasonOf(a) : a].cost - m.W[dcfg.real ? m.seasonOf(b) : b].cost)[0];
  return { g, d: lo(gs.dirs, m.D), a1: lo(gs.pools.a1, m.A), a2: lo(gs.pools.a2, m.A), a3: lo(gs.pools.a3, m.A), w };
}

function decentPick(m, pj, env, dcfg) {
  const ok = Object.keys(pj.genres).filter((g) => pj.genres[g].state === "ok");
  const g = ok.slice().sort((a, b) => (m.G[b].base - m.G[b].cost) - (m.G[a].base - m.G[a].cost))[0];
  const gs = pj.genres[g], plot = m.plotFor(env, g), roleT = [plot.lead.t, plot.side.t, plot.anta.t];
  const byScore = (ids, score, M) => ids.slice().sort((a, b) => score(b) - score(a) || M[b].fee - M[a].fee);
  const dirs = byScore(gs.dirs, (id) => (m.inGenre(m.D[id].spec, g) ? 2 : 0) + m.D[id].tone.filter((t) => plot.tones.includes(t)).length, m.D);
  const d = dirs[0];
  const fit = (id, k) => (m.inGenre(m.A[id].g, g) ? 2 : 0) + (m.A[id].tone.includes(roleT[k]) ? 2 : 0) + (m.LOYAL.some((l) => l[0] === d && l[1] === id) ? 1 : 0);
  const casts = ["a1", "a2", "a3"].map((k, i) => byScore(gs.pools[k], (id) => fit(id, i), m.A));
  const wins = windowsOf(m, pj, dcfg), sid = (w) => (dcfg.real ? m.seasonOf(w) : w);
  const good = wins.filter((w) => plot.win.includes(sid(w)));
  const w = (good.length ? good : wins).slice().sort((a, b) => m.W[sid(a)].cost - m.W[sid(b)].cost)[0];
  // Over budget: drop the priciest pick to its next option on the list until it fits.
  const lists = { d: dirs, a1: casts[0], a2: casts[1], a3: casts[2] }, at = { d: 0, a1: 0, a2: 0, a3: 0 };
  const cur = () => ({ g, d: lists.d[at.d], a1: lists.a1[at.a1], a2: lists.a2[at.a2], a3: lists.a3[at.a3], w });
  for (let i = 0; i < 40 && m.costOf(cur(), dcfg) > pj.budget; i++) {
    const p = cur(), fee = (k) => (k === "d" ? m.D[p.d].fee : m.A[p[k]].fee);
    const k = ["d", "a1", "a2", "a3"].filter((x) => lists[x].slice(at[x] + 1).some((id) => (x === "d" ? m.D[id].fee : m.A[id].fee) < fee(x)))
      .sort((a, b) => fee(b) - fee(a))[0];
    if (!k) break;
    const next = lists[k].findIndex((id, j) => j > at[k] && (k === "d" ? m.D[id].fee : m.A[id].fee) < fee(k));
    at[k] = next;
  }
  const p = cur();
  if (m.costOf(p, dcfg) <= pj.budget) return p;
  return cheapest(m, pj, g, dcfg);
}

if (!isMainThread) {
  parentPort.postMessage(simulate(workerData));
} else {
  const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : d; };
  const runs = +arg("runs", 40), films = +arg("films", 80), workers = +arg("workers", Math.max(1, os.cpus().length - 4));
  const cfgPath = arg("config", fileURLToPath(new URL("data/campaign.json", ROOT)));
  execFileSync(process.execPath, [fileURLToPath(new URL("tools/build_functions.mjs", ROOT))], { stdio: "ignore" });
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const ach = JSON.parse(fs.readFileSync(fileURLToPath(new URL("data/achievements.json", ROOT)), "utf8"));
  const jobs = [];
  for (const policy of (arg("policies", "random,decent")).split(",")) for (let run = 0; run < runs; run++) jobs.push({ cfg, ach, policy, run, films });
  const results = [];
  const t0 = Date.now();
  await new Promise((done) => {
    let next = 0, live = 0;
    const launch = () => {
      if (next >= jobs.length) { if (!live) done(); return; }
      const job = jobs[next++]; live++;
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: job });
      w.on("message", (r) => results.push(r));
      w.on("error", (e) => { console.error(job.policy, job.run, e); });
      w.on("exit", () => { live--; process.stderr.write("."); launch(); });
    };
    for (let i = 0; i < workers; i++) launch();
  });
  process.stderr.write(`\n${results.length} campaigns in ${Math.round((Date.now() - t0) / 1000)}s\n`);
  const q = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
  const fmt = (xs) => (xs.length ? `${q(xs, 0.5)} (p10 ${q(xs, 0.1)}, p90 ${q(xs, 0.9)})` : "—");
  for (const policy of [...new Set(results.map((r) => r.policy))]) {
    const rs = results.filter((r) => r.policy === policy);
    console.log(`\n${policy}: ${rs.length} campaigns, up to ${films} films each`);
    for (const s of cfg.ladder.slice(1)) {
      const hit = rs.filter((r) => r.reached[s.id]).map((r) => r.reached[s.id]);
      console.log(`  ${s.id.padEnd(7)} at $${String(s.at).padEnd(5)} films ${fmt(hit)}${hit.length < rs.length ? `  · ${rs.length - hit.length} never got there` : ""}`);
    }
    const b = rs.map((r) => r.bailouts), pf = rs.flatMap((r) => r.profits);
    console.log(`  bailouts per campaign: mean ${(b.reduce((a, x) => a + x, 0) / b.length).toFixed(2)}, ${b.filter((x) => x > 0).length} of ${rs.length} campaigns had one`);
    console.log(`  profit per film: median $${q(pf, 0.5).toFixed(1)}M (p10 ${q(pf, 0.1).toFixed(1)}, p90 ${q(pf, 0.9).toFixed(1)}), flops ${Math.round(pf.filter((x) => x < 0).length / pf.length * 100)}%`);
  }
}
