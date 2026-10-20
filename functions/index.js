// GREENLIGHT Cloud Functions (campaign callables at the end).
// release: a signed-in player submits today's film; the server checks and re-scores it (game.js), then keeps
// that player's best film of the day on the board and in their own history.
//   boards/{board}/entries/{uid}   public leaderboard row (board = "r3-<type>-<diff>_<day>")
//   users/{uid}/runs/{board}       the same row, private to the player (their progression)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { loadGame, check, Reject } = require("./game");

setGlobalOptions({ maxInstances: 10 });
initializeApp();
const db = getFirestore();
const game = loadGame();

const round1 = (x) => Math.round(x * 10) / 10;
const KEEP = ["profit", "gross", "cost", "title", "genre", "pick"];

exports.release = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in to post to the leaderboard.");
  let run;
  try {
    run = check(game, req.data);
  } catch (e) {
    if (e instanceof Reject) throw new HttpsError("invalid-argument", e.message);
    throw e;
  }
  const uid = req.auth.uid, tok = req.auth.token || {};
  const name = String(tok.name || "").trim().slice(0, 40) || "Studio " + uid.slice(0, 5).toUpperCase();
  const film = { profit: round1(run.profit), gross: Math.round(run.gross), cost: run.cost, title: run.title, genre: run.p.g, pick: run.p };
  const entryRef = db.doc(`boards/${run.board}/entries/${uid}`);
  const runRef = db.doc(`users/${uid}/runs/${run.board}`);

  const out = await db.runTransaction(async (tx) => {
    const cur = await tx.get(entryRef);
    const prev = cur.exists ? cur.data() : null;
    const better = !prev || film.profit > prev.profit;
    const best = better ? film : Object.fromEntries(KEEP.map((k) => [k, prev[k]]));
    const attempts = ((prev && prev.attempts) || 0) + 1;
    const row = { uid, name, photo: tok.picture || null, ...best, attempts, type: run.type, diff: run.diff, day: run.day, roster: game.version, updated: FieldValue.serverTimestamp() };
    tx.set(db.doc(`boards/${run.board}`), { type: run.type, diff: run.diff, day: run.day }, { merge: true });
    tx.set(entryRef, row);
    tx.set(runRef, row);
    return { best, attempts, better };
  });

  const entries = db.collection(`boards/${run.board}/entries`);
  const [ahead, total] = await Promise.all([entries.where("profit", ">", out.best.profit).count().get(), entries.count().get()]);
  return { board: run.board, film, best: out.best, better: out.better, attempts: out.attempts, rank: ahead.data().count + 1, total: total.data().count };
});

// Campaign (solo career): every write goes through these callables; the rules live in campaign.js and the
// transactions in campaign_store.js. Each returns the player's updated studio so the page needs no extra reads.
const { loadCampaign } = require("./campaign");
const { makeStore } = require("./campaign_store");
// Studio images live in the default bucket; the store only reads their metadata and deletes them.
const files = {
  async meta(path) {
    const f = getStorage().bucket().file(path);
    const [ok] = await f.exists();
    if (!ok) return null;
    const [md] = await f.getMetadata();
    return { contentType: md.contentType, size: Number(md.size), generation: md.generation };
  },
  remove: (path) => getStorage().bucket().file(path).delete({ ignoreNotFound: true }),
};
const store = makeStore(db, loadCampaign(game), files);

function campaignCall(fn) {
  return onCall(async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in to run a studio.");
    try {
      return await fn(req.auth.uid, req.data || {}, Date.now());
    } catch (e) {
      if (e instanceof Reject) throw new HttpsError("failed-precondition", e.message);
      throw e;
    }
  });
}
exports.campaignStart = campaignCall(store.start);
exports.campaignProject = campaignCall(store.project);
exports.campaignRelease = campaignCall(store.release);
exports.campaignPass = campaignCall(store.pass);
exports.campaignRename = campaignCall(store.rename);
exports.campaignUpgrade = campaignCall(store.upgrade);
exports.campaignStyle = campaignCall(store.style);
