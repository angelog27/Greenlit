// Awards (data/awards.json). Pure functions: tests run them without Firebase.
//   Golden Reel Awards: every `season.films` campaign films, the season's best in each category faces a rival
//   studio's bar (seeded, tougher at higher tiers). A win adds prize money to the bank (not lifetime profit).
//   Greenlight Globes: each UTC week (Monday to Sunday) studios submit up to `weekly.maxFilms` of that week's
//   films; after the week a scheduled job ranks every studio's best film per category and crowns a podium.
// Every film gets award scores (0-100, plus gross/profit) when it is released, from the same facts the scoring
// model uses: how well the director and cast fit the genre and their parts, the script, timing and synergies.

const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));

// Scores for one released film. env/cfg/p are the ones the film was scored with; r is evalFilm's result.
function filmScores(m, A, env, p, cfg, r) {
  const S = A.scores, plot = m.plotFor(env, p.g), d = m.D[p.d], cast = [m.A[p.a1], m.A[p.a2], m.A[p.a3]];
  const roleT = [plot.lead.t, plot.side.t, plot.anta.t];
  const director = clamp(S.director.base + S.director.fit[m.fitLevel(d.spec, p.g)] +
    S.director.tone * d.tone.filter((t) => plot.tones.includes(t)).length + (m.dirSkill(env, d, p.g) - 1) * S.director.skill);
  const role = (a, k) => clamp(S.role.base + S.role.star * m.starOf(env, a, p.g) + (m.inGenre(a.g, p.g) ? S.role.genre : 0) + (a.tone.includes(roleT[k]) ? S.role.tone : 0));
  const [lead, supporting, villain] = cast.map(role);
  const tones = [d].concat(cast).reduce((n, x) => n + x.tone.filter((t) => plot.tones.includes(t)).length, 0);
  const screenplay = clamp(S.screenplay.base + (m.scriptQ(env, p.g) - 1) * S.screenplay.script +
    (plot.win.includes(m.winId(p, cfg)) ? S.screenplay.timing : 0) + S.screenplay.tone * Math.min(5, tones));
  const W = S.critics, critics = clamp(W.director * director + W.lead * lead + W.supporting * supporting + W.villain * villain + W.screenplay * screenplay);
  let chem = 0;
  const ids = [p.a1, p.a2, p.a3];
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (m.CHEM.some((c) => m.pairKey(c[0], c[1]) === m.pairKey(ids[i], ids[j]))) chem++;
  const reunions = m.LOYAL.filter((l) => l[0] === p.d && ids.includes(l[1])).length;
  const ensemble = clamp((lead + supporting + villain) / 3 + S.ensemble.chemistry * chem + S.ensemble.reunion * reunions - 20);
  // Audience score: did people love it? The cast's fit, the script and the critics, pulled down by audience
  // fatigue and moved twice as hard as the box office by on-set news.
  const prod = m.prodQ ? m.prodQ(env, p.g) : 1, fat = m.fatigueQ ? m.fatigueQ(env, p) : 1;
  const audience = clamp((0.4 * (lead + supporting + villain) / 3 + 0.3 * screenplay + 0.3 * critics) * fat * (1 + 2 * (prod - 1)));
  return { critics, director, lead, supporting, villain, screenplay, ensemble, audience, gross: Math.round(r.gross), profit: Math.round(r.profit * 10) / 10, breakout: m.boomQ(env, p.g) };
}

// The season's ceremony: for each category, the season's best film against a rival bar for the studio's tier.
// rnd() is seeded by the caller (studio + season), so a ceremony can't be replayed for a better result.
function seasonCeremony(A, films, tier, rnd) {
  const R = A.season.rivals, wins = [], losses = [];
  let prize = 0;
  A.season.categories.forEach((c) => {
    const best = films.slice().sort((a, b) => b.scores[c.score] - a.scores[c.score])[0];
    const base = c.score === "gross" ? R.gross[tier] : R.score[tier], bar = Math.round(base * (1 - R.spread + 2 * R.spread * rnd()));
    const row = { cat: c.id, name: c.name, title: best.title, value: best.scores[c.score], bar, who: who(c.score, best), people: [best.d].concat(best.cast || []).filter(Boolean) };
    if (row.value >= bar) { wins.push(Object.assign(row, { prize: c.prize, points: c.points || 0 })); prize += c.prize; } else losses.push(row);
  });
  return { wins, losses, prize };
}
function who(score, f) {
  return { director: f.d, lead: f.cast && f.cast[0], supporting: f.cast && f.cast[1], villain: f.cast && f.cast[2] }[score] || null;
}

// UTC week of a timestamp, Monday 00:00 to Sunday 23:59: { id: "2026-W43", start, end }.
function weekOf(t) {
  const d = new Date(t), day = (d.getUTCDay() + 6) % 7;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  const thu = new Date(start + 3 * 86400000), y = thu.getUTCFullYear(), jan4 = Date.UTC(y, 0, 4);
  const w1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86400000, n = Math.round((start - w1) / (7 * 86400000)) + 1;
  return { id: y + "-W" + String(n).padStart(2, "0"), start, end: start + 7 * 86400000 };
}

// Weekly results: each studio's best submitted film per category, ranked; ties go to the earlier submission.
function finalizeWeek(A, entries) {
  const out = {};
  A.weekly.categories.forEach((c) => {
    const rows = entries.map((e) => {
      const f = e.films.slice().sort((a, b) => b.scores[c.score] - a.scores[c.score] || b.scores.gross - a.scores.gross)[0];
      return f && { uid: e.uid, studioName: e.studioName, logo: e.logo || null, color: e.color || null, title: f.title, genre: f.genre, value: f.scores[c.score], gross: f.scores.gross, at: e.at, people: [f.d].concat(f.cast || []).filter(Boolean) };
    }).filter((x) => x && (c.score !== "breakout" || x.value > 1));
    rows.sort((a, b) => b.value - a.value || b.gross - a.gross || a.at - b.at);
    out[c.id] = rows.slice(0, A.weekly.podium);
  });
  return out;
}

module.exports = { filmScores, seasonCeremony, weekOf, finalizeWeek };
