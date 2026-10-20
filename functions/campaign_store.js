// Firestore side of the campaign: each callable is one transaction around the pure rules in campaign.js.
//   campaigns/{uid}               the player's studio (bank, unlocks, badges, current project); owner reads only
//   campaigns/{uid}/films/{index} one released film, keyed by project index (also the idempotency record)
//   campaignBoard/{uid}           public row once the studio reaches the board goal (A-tier)
// Callables: start, project, release, pass, reroll, upgrade, style, rename.
// Takes `db` (the Admin Firestore, or a stand-in with doc() and runTransaction() in tests) and `files` (Storage:
// meta(path) -> { contentType, size, generation } or null, head(path) -> first bytes, remove(path)).
//   studios/{uid}/logo, studios/{uid}/backdrop   the studio's images in Storage, uploaded by the owner
const crypto = require("crypto");
const camp = require("./campaign");
const { Reject } = require("./game");
const { isImageBytes } = require("./limits");

const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const filmId = (i) => String(i).padStart(5, "0");
// The model runs in its own vm realm; Firestore only stores plain objects of this realm, so copy through JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

const IMAGE = /^image\/(jpeg|png|webp)$/;

function makeStore(db, C, files) {
  const ref = (uid) => db.doc(`campaigns/${uid}`);
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
      if (board && board.exists) tx.set(db.doc(`campaignBoard/${uid}`), Object.assign({}, board.data(), { displayName: next.studioName }));
      return { state: next };
    }),
  };
}

module.exports = { makeStore, filmId };
