// Firestore side of the campaign: each callable is one transaction around the pure rules in campaign.js.
//   campaigns/{uid}               the player's studio (bank, unlocks, badges, current project); owner reads only
//   campaigns/{uid}/films/{index} one released film, keyed by project index (also the idempotency record)
//   campaignBoard/{uid}           public row once the studio reaches the board goal (A-tier)
//   studios/{uid}                 public studio card (look, level, badges, best film), rewritten on every change to them
//   awards/{week}                 Greenlight Globes week (status, and the results once final)
//   awards/{week}/entries/{uid}   a studio's submitted films for that week (public)
// Callables: start, project, release, pass, reroll, pickScript, identity, upgrade, style, rename.
// Takes `db` (the Admin Firestore, or a stand-in with doc() and runTransaction() in tests) and `files` (Storage:
// meta(path) -> { contentType, size, generation } or null, head(path) -> first bytes, remove(path)).
//   studios/{uid}/logo, studios/{uid}/backdrop   the studio's images in Storage, uploaded by the owner
const crypto = require("crypto");
const camp = require("./campaign");
const { Reject } = require("./game");
const { isImageBytes } = require("./limits");
const awards = require("./awards");

const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const filmId = (i) => String(i).padStart(5, "0");
// The model runs in its own vm realm; Firestore only stores plain objects of this realm, so copy through JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

const IMAGE = /^image\/(jpeg|png|webp)$/;

function makeStore(db, C, files) {
  const ref = (uid) => db.doc(`campaigns/${uid}`);
  const card = (tx, uid, st, now) => tx.set(db.doc(`studios/${uid}`), plain(camp.publicStudio(C, uid, camp.normalize(st), now || Date.now())));
  const load = async (tx, uid) => {
    const s = await tx.get(ref(uid));
    if (!s.exists) throw new Reject("Start your studio first.");
    return camp.normalize(s.data());
  };
  return {
    // Creates the studio, or returns the existing one unchanged.
    start: (uid, data, now) => db.runTransaction(async (tx) => {
      const s = await tx.get(ref(uid));
      if (s.exists) return { state: camp.normalize(s.data()), created: false };
      const cid = crypto.randomBytes(6).toString("hex");
      const st = plain(camp.newCampaign(C, uid, cid, data && data.studioName, utcDay(now), now));
      tx.set(ref(uid), st);
      card(tx, uid, st, now);
      return { state: st, created: true };
    }),
    // The current project; { hard } switches it to real release dates and back (A-tier only).
    project: (uid, data, now) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      if (!data || data.hard === undefined) return { state: st };
      const next = plain(camp.setHard(C, st, uid, data));
      if (next.currentProject.diff !== st.currentProject.diff) tx.set(ref(uid), next);
      return { state: next };
    }),
    // Idempotent: releasing a project that was already released returns the stored result.
    release: (uid, data, now) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      const index = data && data.index;
      if (Number.isInteger(index) && st.currentProject && index < st.currentProject.index) {
        const f = await tx.get(db.doc(`campaigns/${uid}/films/${filmId(index)}`));
        if (f.exists) { const film = f.data(); return { state: st, film, events: film.events, replay: true }; }
      }
      const out = plain(camp.release(C, st, uid, data, utcDay(now), now));
      tx.set(ref(uid), out.state);
      card(tx, uid, out.state, now);
      tx.set(db.doc(`campaigns/${uid}/films/${filmId(out.film.projectIndex)}`), Object.assign({}, out.film, { events: out.events }));
      if (out.board) tx.set(db.doc(`campaignBoard/${uid}`), out.board);
      return { state: out.state, film: out.film, events: out.events, replay: false };
    }),
    // Swap one genre's pitch on the current project (studio level perk).
    reroll: (uid, data) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      const next = plain(camp.reroll(C, st, uid, data));
      tx.set(ref(uid), next);
      return { state: next };
    }),
    // Greenlight Globes: submit (or replace) up to weekly.maxFilms of this week's films. The server reads the
    // films from the studio's own history, so only real films released this week can be entered.
    submitAwards: (uid, data, now) => db.runTransaction(async (tx) => {
      const A = C.awd, wk = awards.weekOf(now), list = data && data.films;
      if (!Array.isArray(list) || !list.length || list.length > A.weekly.maxFilms || new Set(list).size !== list.length || !list.every((x) => Number.isInteger(x) && x >= 0))
        throw new Reject(`Pick 1 to ${A.weekly.maxFilms} different films from this week.`);
      const st = await load(tx, uid);
      const snaps = await Promise.all(list.map((i) => tx.get(db.doc(`campaigns/${uid}/films/${filmId(i)}`))));
      const films = snaps.map((s, k) => {
        const f = s.exists ? s.data() : null;
        if (!f || !f.scores) throw new Reject("One of those films can't be entered.");
        if (f.at < wk.start || f.at >= wk.end) throw new Reject("Only films released this week (Monday to Sunday, UTC) can be entered.");
        return { projectIndex: list[k], title: f.title, genre: f.genre, d: f.d || null, cast: f.cast || null, scores: f.scores };
      });
      const pr = st.profile || {};
      const entry = { uid, week: wk.id, studioName: st.studioName, logo: pr.logo || null, color: pr.color || null, type: (st.identity && st.identity.type) || null, films, at: now };
      tx.set(db.doc(`awards/${wk.id}`), { week: wk.id, start: wk.start, end: wk.end, status: "open" }, { merge: true });
      tx.set(db.doc(`awards/${wk.id}/entries/${uid}`), entry);
      return { week: wk.id, entry };
    }),
    // After a week closes: rank every entry, store the results, pay and credit each category winner. Runs once.
    finalizeWeek: async (weekId, now) => {
      const A = C.awd, head = db.doc(`awards/${weekId}`);
      const entries = (await db.collection(`awards/${weekId}/entries`).get()).docs.map((d) => d.data());
      const results = awards.finalizeWeek(A, entries);
      const done = await db.runTransaction(async (tx) => {
        const h = await tx.get(head);
        if (h.exists && h.data().status === "final") return false;
        tx.set(head, { week: weekId, status: "final", results, entries: entries.length, finalizedAt: now }, { merge: true });
        return true;
      });
      if (!done) return { skipped: true };
      for (const c of A.weekly.categories) {
        const win = (results[c.id] || [])[0];
        if (!win) continue;
        await db.runTransaction(async (tx) => {
          const s = await tx.get(ref(win.uid));
          if (!s.exists) return;
          const st = camp.normalize(s.data()), g = Object.assign({ wins: 0, byCat: {} }, st.globes);
          g.byCat = Object.assign({}, g.byCat, { [c.id]: (g.byCat[c.id] || 0) + 1 });
          g.wins++;
          const next = Object.assign({}, st, { globes: g, bank: Math.round((st.bank + c.prize) * 10) / 10, badges: Object.assign({}, st.badges), bonusPoints: (st.bonusPoints || 0) + (c.points || 0),
            awards: [{ kind: "weekly", week: weekId, cat: c.id, name: c.name, title: win.title, at: now }].concat(st.awards || []).slice(0, 30) });
          camp.awardBadges(C, st, next, null, now);
          // The people behind the winning film like working with you more.
          if (C.evt) next.rel = require("./events").applyRel(C.evt, st.rel, Object.fromEntries((win.people || []).map((id) => [id, C.evt.relationships.awards.globe]))).rel;
          tx.set(ref(win.uid), plain(next));
          card(tx, win.uid, next, now);
        });
      }
      return { results, entries: entries.length };
    },
    // Claim a Genre Master the studio has earned (at most two).
    master: (uid, data, now) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      const out = plain(camp.master(C, st, uid, data, now));
      tx.set(ref(uid), out.state);
      card(tx, uid, out.state, now);
      return out;
    }),
    // Studio type from the onboarding answers (once).
    identity: (uid, data, now) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      const next = plain(camp.identity(C, st, uid, data));
      tx.set(ref(uid), next);
      card(tx, uid, next, now);
      return { state: next };
    }),
    pickScript: (uid, data) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      const next = plain(camp.pickScript(C, st, uid, data));
      tx.set(ref(uid), next);
      return { state: next };
    }),
    pass: (uid, data, now) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      const out = plain(camp.pass(C, st, uid, data, utcDay(now)));
      tx.set(ref(uid), out.state);
      return out;
    }),
    // Spend upgrade points (one per studio level).
    upgrade: (uid, data, now) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      const out = plain(camp.upgrade(C, st, uid, data, now));
      tx.set(ref(uid), out.state);
      card(tx, uid, out.state, now);
      return out;
    }),
    // Colour, tagline, city, and logo/backdrop: true = "I uploaded a new one, check it", false = remove it.
    style: async (uid, data, now) => {
      const x = data || {}, images = {}, P = C.cfg.profile;
      for (const k of ["logo", "backdrop"]) {
        const path = `studios/${uid}/${k}`;
        if (x[k] === true) {
          const meta = files && (await files.meta(path));
          if (!meta) throw new Reject("The image didn't finish uploading. Try again.");
          if (!IMAGE.test(meta.contentType || "")) throw new Reject("Images must be JPEG, PNG or WebP.");
          if (meta.size > P[k + "KB"] * 1024) throw new Reject(`That image is too big (max ${P[k + "KB"]} KB).`);
          // The type is whatever the browser declared; the file itself must start like a JPEG, PNG or WebP.
          if (!isImageBytes(await files.head(path))) { await files.remove(path); throw new Reject("That file isn't a real image."); }
          images[k] = String(meta.generation || now);
        } else if (x[k] === false) {
          if (files) await files.remove(path);
          images[k] = null;
        }
      }
      return db.runTransaction(async (tx) => {
        const st = await load(tx, uid);
        const board = st.aTierFilms !== null ? await tx.get(db.doc(`campaignBoard/${uid}`)) : null;
        const next = plain(camp.style(C, st, x, images));
        tx.set(ref(uid), next);
        card(tx, uid, next, now);
        if (board && board.exists) tx.set(db.doc(`campaignBoard/${uid}`), Object.assign({}, board.data(), { logo: next.profile.logo || null, color: next.profile.color || null }));
        return { state: next };
      });
    },
    // Once only. Also renames the board row if the studio is already on it.
    rename: (uid, data) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      const board = st.aTierFilms !== null ? await tx.get(db.doc(`campaignBoard/${uid}`)) : null;
      const next = camp.rename(st, data && data.name);
      tx.set(ref(uid), next);
      card(tx, uid, next);
      if (board && board.exists) tx.set(db.doc(`campaignBoard/${uid}`), Object.assign({}, board.data(), { displayName: next.studioName }));
      return { state: next };
    }),
  };
}

module.exports = { makeStore, filmId };
