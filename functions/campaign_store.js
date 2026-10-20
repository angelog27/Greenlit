// Firestore side of the campaign: each callable is one transaction around the pure rules in campaign.js.
//   campaigns/{uid}               the player's studio (bank, unlocks, badges, current project); owner reads only
//   campaigns/{uid}/films/{index} one released film, keyed by project index (also the idempotency record)
//   campaignBoard/{uid}           public row once the studio reaches the board goal (A-tier)
// Takes `db` (the Admin Firestore, or a stand-in with doc() and runTransaction() in tests).
const crypto = require("crypto");
const camp = require("./campaign");
const { Reject } = require("./game");

const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const filmId = (i) => String(i).padStart(5, "0");
// The model runs in its own vm realm; Firestore only stores plain objects of this realm, so copy through JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

function makeStore(db, C) {
  const ref = (uid) => db.doc(`campaigns/${uid}`);
  const load = async (tx, uid) => {
    const s = await tx.get(ref(uid));
    if (!s.exists) throw new Reject("Start your studio first.");
    return s.data();
  };
  return {
    // Creates the studio, or returns the existing one unchanged.
    start: (uid, data, now) => db.runTransaction(async (tx) => {
      const s = await tx.get(ref(uid));
      if (s.exists) return { state: s.data(), created: false };
      const cid = crypto.randomBytes(6).toString("hex");
      const st = plain(camp.newCampaign(C, uid, cid, data && data.studioName, utcDay(now), now));
      tx.set(ref(uid), st);
      return { state: st, created: true };
    }),
    // The current project; { hard } switches it to real release dates and back (A-tier only).
    project: (uid, data, now) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      if (!data || data.hard === undefined) return { state: st };
      const next = plain(camp.setHard(C, st, uid, data, utcDay(now)));
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
      tx.set(db.doc(`campaigns/${uid}/films/${filmId(out.film.projectIndex)}`), Object.assign({}, out.film, { events: out.events }));
      if (out.board) tx.set(db.doc(`campaignBoard/${uid}`), out.board);
      return { state: out.state, film: out.film, events: out.events, replay: false };
    }),
    pass: (uid, data, now) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      const out = plain(camp.pass(C, st, uid, data, utcDay(now)));
      tx.set(ref(uid), out.state);
      return out;
    }),
    // Once only. Also renames the board row if the studio is already on it.
    rename: (uid, data) => db.runTransaction(async (tx) => {
      const st = await load(tx, uid);
      const board = st.aTierFilms !== null ? await tx.get(db.doc(`campaignBoard/${uid}`)) : null;
      const next = camp.rename(st, data && data.name);
      tx.set(ref(uid), next);
      if (board && board.exists) tx.set(db.doc(`campaignBoard/${uid}`), Object.assign({}, board.data(), { displayName: next.studioName }));
      return { state: next };
    }),
  };
}

module.exports = { makeStore, filmId };
