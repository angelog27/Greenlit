// Roster coverage per campaign tier: how many actors (by gender) and directors each tier has, and at each
// unlock step whether the shortlists fill from unlocked tiers alone or need loans from the next tier up.
// Run after changing data/actors.json, data/directors.json or the thresholds in data/campaign.json.
//   node tools/campaign_report.mjs
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

execFileSync(process.execPath, [fileURLToPath(new URL("build_functions.mjs", import.meta.url))], { stdio: "ignore" });
const require = createRequire(import.meta.url);
const { loadGame } = require("../functions/game.js");
const camp = require("../functions/campaign.js");
const C = camp.loadCampaign(loadGame());
const { m, cfg, order } = C;

console.log("Tier  Actors (m/f)  Directors");
for (const t of order.slice().reverse()) {
  const a = (s) => m.ACTORS.filter((x) => x.s === s && C.actorTier[x.id] === t).length;
  console.log(`  ${t}   ${String(a("m")).padStart(4)} / ${String(a("f")).padEnd(6)} ${m.DIRS.filter((d) => C.dirTier[d.id] === t).length}`);
}
const per = cfg.shortlist.perGender * 3;
console.log(`\nUnlock step          cast tier  m/f available (need ${per} each)  loans  directors`);
for (const s of cfg.ladder) {
  const u = camp.unlocksFor(C, s.at), cap = C.rank(u.actorTier);
  const have = (g) => m.ACTORS.filter((x) => x.s === g && C.rank(C.actorTier[x.id]) <= cap).length;
  const dirs = m.DIRS.filter((d) => C.rank(C.dirTier[d.id]) <= C.rank(u.directorTier)).length;
  const loans = Math.max(0, per - have("m")) + Math.max(0, per - have("f"));
  console.log(`  $${String(s.at).padEnd(5)} ${s.id.padEnd(10)} ${u.actorTier}          ${have("m")}/${have("f")}`.padEnd(58) + `${String(loans).padEnd(6)} ${Math.min(dirs, cfg.shortlist.directors)} of ${dirs}`);
}
