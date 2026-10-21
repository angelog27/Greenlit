// Campaign stories (data/events.json): what makes every studio's career different. Pure and seeded, so a studio
// can't re-roll its luck, and two studios never live the same career.
//   traits    each person may get a personality trait in *this* studio's world (seeded per campaign); traits
//             make some on-set events likelier. Fiction for the game, not claims about the real person.
//   declines  when a project opens, some shortlisted people pass on it; new, low-level studios hear "no" a lot,
//             studio level and the Reputation upgrade help. Enough people always stay to make a film.
//   fatigue   env.hist: the studio's recent scripts, directors, actors and genre streak, for the model's
//             "Audience fatigue" step (repeat yourself and audiences notice).
//   events    at release, sometimes something happens on set: box office, cost and critics can move.
//   relationships  the studio's standing with each person (-100..100), moved by films, on-set events and awards.
//             Friends say yes, turn up on shortlists, give a friends rate and rarely clash; feuds refuse.

function traitOf(m, E, seed, id) {
  const r = m.rng(m.hash(seed + "|trait|" + id));
  if (r() >= E.traits.chance) return null;
  return E.traits.list[Math.floor(r() * E.traits.list.length)];
}

// Splits one genre's shortlists into who said yes and who passed. pools: [[ids], [ids], [ids]], dirs: [ids].
function declines(m, E, ctx, key, gid, pools, dirs) {
  const D = E.declines, R = E.relationships, rel = ctx.rel || {}, rnd = (id) => m.rng(m.hash(key + "|decline|" + gid + "|" + id))();
  const fans = ctx.fans === null || ctx.fans === undefined ? 0 : E.popcorn.declines * (ctx.fans - E.popcorn.mid);
  const chance = (id, star) => Math.max(D.min, Math.min(D.max, D.base - D.perLevel * (ctx.level - 1) - D.reputation * ctx.reputation + D.star * Math.max(0, star - 5) - R.decline * (rel[id] || 0) - fans));
  const reason = (id) => ((rel[id] || 0) <= R.feud ? "Won't work with your studio" : D.reasons[Math.floor(m.rng(m.hash(key + "|why|" + id))() * D.reasons.length)]);
  const split = (ids, star, keep, role) => {
    const rolls = ids.map((id) => ({ id, r: rnd(id), feud: (rel[id] || 0) <= R.feud, no: (rel[id] || 0) <= R.feud || rnd(id) < chance(id, star(id)) }));
    // Keep enough people: un-decline the least reluctant first (never someone feuding with the studio).
    let yes = rolls.filter((x) => !x.no).length;
    rolls.filter((x) => x.no && !x.feud).sort((a, b) => b.r - a.r).forEach((x) => { if (yes < keep) { x.no = false; yes++; } });
    return { yes: ids.filter((id) => !rolls.find((x) => x.id === id).no), no: rolls.filter((x) => x.no).map((x) => ({ id: x.id, role, reason: reason(x.id), feud: x.feud })) };
  };
  const out = { pools: [], dirs: null, declined: [] };
  pools.forEach((ids, k) => {
    const s = split(ids, (id) => m.A[id].star, D.keepPerRole, ["a1", "a2", "a3"][k]);
    out.pools.push(s.yes); out.declined = out.declined.concat(s.no);
  });
  const sd = split(dirs, (id) => 5 + (m.D[id].skill - 1) * 20, D.keepDirectors, "d");
  out.dirs = sd.yes; out.declined = out.declined.concat(sd.no);
  return out;
}

// The model's fatigue input from the studio's history.
function histFor(E, st) {
  const F = E.fatigue, recent = (st.recentPicks || []).slice(0, F.window), dirs = {}, actors = {};
  recent.forEach((f) => { dirs[f.d] = (dirs[f.d] || 0) + 1; (f.cast || []).forEach((a) => { actors[a] = (actors[a] || 0) + 1; }); });
  let n = 0;
  const first = (st.recentPicks || [])[0];
  if (first) for (const f of st.recentPicks) { if (f.g === first.g) n++; else break; }
  return { w: F, scripts: Object.assign({}, st.madeScripts), dirs, actors, streak: first ? { g: first.g, n } : null, mastered: Object.keys(st.perks || {}) };
}

// Maybe an on-set event for this film. Weights follow the cast's and director's traits; some events need a
// condition (chemistry between two of the cast, or critics already high).
function rollEvent(m, E, seed, key, p, facts) {
  const R = E.relationships, rel = facts.rel || {}, cast = [p.a1, p.a2, p.a3];
  const strained = cast.concat([p.d]).some((id) => (rel[id] || 0) <= R.strained), friends = cast.concat([p.d]).every((id) => (rel[id] || 0) >= R.friend);
  const r = m.rng(m.hash(key + "|event|" + [p.g, p.d, p.a1, p.a2, p.a3, p.w].join("|")));
  if (r() >= E.chance) return null;
  const people = [p.d, p.a1, p.a2, p.a3], traits = people.map((id) => traitOf(m, E, seed, id));
  const weights = E.list.map((ev) => {
    if (ev.needs === "chemistry" && !facts.chem) return 0;
    if (ev.needs === "acclaim" && !(facts.critics >= 70)) return 0;
    const w = traits.reduce((x, t) => x * (t && t.events[ev.id] !== undefined ? t.events[ev.id] : 1), ev.weight);
    // People who don't get along with the studio fight more; a set of friends rarely does.
    if (ev.id === "clash" || ev.id === "walkout") return w * (strained ? R.clash.strained : 1) * (friends ? R.clash.friends : 1);
    return w;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let roll = r() * total, i = 0;
  while (i < weights.length - 1 && roll >= weights[i]) { roll -= weights[i]; i++; }
  const ev = E.list[i];
  // Who it's about: a trait that caused it if there is one, else seeded picks.
  const pickA = () => {
    const hot = cast.filter((id, k) => traits[k + 1] && traits[k + 1].events[ev.id] > 1);
    return (hot.length ? hot : cast)[Math.floor(r() * (hot.length || 3))];
  };
  const a = pickA(), b = cast.filter((x) => x !== a)[Math.floor(r() * 2)];
  return { id: ev.id, title: ev.title, a, b, d: p.d, gross: ev.gross || 1, cost: ev.cost || 0, costShare: ev.costShare || 0, critics: ev.critics || 0, template: ev.text };
}
// The event's sentence with names and money filled in (the page does the same with its own copy of the names).
function eventText(m, ev, cost) {
  const nm = (id) => (m.A[id] || m.D[id] || {}).name || id;
  return ev.template.replace(/\{a\}/g, nm(ev.a)).replace(/\{b\}/g, nm(ev.b)).replace(/\{d\}/g, nm(ev.d)).replace(/\{cost\}/g, "$" + cost + "M");
}

// How a film moved the studio's relationships: { personId: delta } from the result, the audience and its event.
function relDeltas(E, p, profit, audience, boom, ev) {
  const R = E.relationships, F = R.film, people = [p.d, p.a1, p.a2, p.a3], out = {};
  const add = (id, v) => { if (id && v) out[id] = (out[id] || 0) + v; };
  const base = profit > 0 ? (boom ? F.breakout : F.hit) : F.flop;
  const aud = audience >= F.highAt ? F.audienceHigh : audience < F.lowAt ? F.audienceLow : 0;
  people.forEach((id) => add(id, base + aud));
  const e = ev && R.events[ev.id];
  if (e) { add(ev.a, e.a); add(ev.b, e.b); add(ev.d, e.d); if (e.all) people.forEach((id) => add(id, e.all)); }
  return out;
}
// Applies deltas to a relationship map; returns the new map and the changes ({ id, delta, to }).
function applyRel(E, rel, deltas) {
  const R = E.relationships, next = Object.assign({}, rel), changes = [];
  Object.entries(deltas).forEach(([id, d]) => {
    if (!d) return;
    const to = Math.max(R.min, Math.min(R.max, Math.round((next[id] || 0) + d)));
    if (to !== (next[id] || 0)) { changes.push({ id, delta: to - (next[id] || 0), to }); next[id] = to; }
  });
  return { rel: next, changes };
}
// Fee multipliers for the project env: a friends rate, or a premium from people who are strained with you.
function relFees(E, rel) {
  const R = E.relationships, out = {};
  Object.entries(rel || {}).forEach(([id, v]) => {
    if (v >= R.friend) out[id] = 1 - R.friendFee; else if (v <= R.strained) out[id] = 1 + R.strainedFee;
  });
  return out;
}

// Popcorn (audience) score. Word of mouth: a film's own score moves its box office. Fan base: the average of the
// studio's last few films moves every next film (and how keen talent is to sign on).
function womFor(E, audience) {
  const P = E.popcorn;
  return Math.round((1 + Math.max(-P.womCap, Math.min(P.womCap, P.wom * (audience - P.mid)))) * 100) / 100;
}
function fanAvg(E, st) {
  const list = (st.popcorn || []).slice(0, E.popcorn.window);
  return list.length >= E.popcorn.fansMin ? list.reduce((a, b) => a + b, 0) / list.length : null;
}
function fansFor(E, st) {
  const P = E.popcorn, avg = fanAvg(E, st);
  return avg === null ? 1 : Math.round((1 + Math.max(-P.fansCap, Math.min(P.fansCap, P.fans * (avg - P.mid)))) * 100) / 100;
}

module.exports = { traitOf, declines, histFor, rollEvent, eventText, relDeltas, applyRel, relFees, womFor, fanAvg, fansFor };
