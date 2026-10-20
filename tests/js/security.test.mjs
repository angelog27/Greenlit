// Security tests against the Firebase emulators (Auth, Functions, Firestore, Storage): what a hostile client
// can do with the public web config. Skipped unless all four emulators are running:
//   node tools/build_functions.mjs && firebase emulators:start --only auth,functions,firestore,storage
// Covers: unauthenticated calls, direct database and storage access, malformed and prototype-key input,
// tampered picks, replays and concurrent double-spends.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const PORTS = { auth: 9099, functions: 5001, firestore: 8080, storage: 9199 };
const open = (port) => new Promise((done) => {
  const s = net.connect({ host: "127.0.0.1", port }, () => { s.destroy(); done(true); });
  s.on("error", () => done(false));
  s.setTimeout(500, () => { s.destroy(); done(false); });
});
const up = (await Promise.all(Object.values(PORTS).map(open))).every(Boolean);
const skip = up ? false : "Auth, Functions, Firestore and Storage emulators not all running";
const PROJECT = JSON.parse(readFileSync(new URL("../../.firebaserc", import.meta.url), "utf8")).projects.default;

let F, Au, Fs, Fn, St, apps = [];
// A fresh signed-in client (its own app instance, so several players can act at once).
async function player(tag) {
  const app = F.initializeApp({ apiKey: "demo-key", projectId: PROJECT, authDomain: "localhost", storageBucket: PROJECT + ".firebasestorage.app" }, tag + Date.now() + Math.random());
  apps.push(app);
  const auth = Au.getAuth(app), db = Fs.getFirestore(app), fns = Fn.getFunctions(app), st = St.getStorage(app);
  Au.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  Fs.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  Fn.connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  St.connectStorageEmulator(st, "127.0.0.1", 9199);
  const c = tag === "anon" ? null : await Au.createUserWithEmailAndPassword(auth, `${tag}${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`, "secret123");
  const call = async (name, data) => (await Fn.httpsCallable(fns, name)(data)).data;
  return { app, auth, db, st, uid: c && c.user.uid, call, user: c && c.user };
}
const denied = (p) => assert.rejects(p, (e) => /permission|PERMISSION_DENIED|unauthorized|storage\/unauthorized/i.test(String(e.code || e.message)));
const refused = (p, re) => assert.rejects(p, (e) => /functions\/(failed-precondition|invalid-argument|unauthenticated)/.test(e.code) && (!re || re.test(e.message)));

before(async () => {
  if (!up) return;
  F = require("firebase/app"); Au = require("firebase/auth"); Fs = require("firebase/firestore"); Fn = require("firebase/functions"); St = require("firebase/storage");
});
after(async () => { if (F) await Promise.all(apps.map((a) => F.deleteApp(a).catch(() => {}))); });

test("signed out: every callable refuses", { skip }, async () => {
  const anon = await player("anon");
  for (const name of ["release", "campaignStart", "campaignProject", "campaignRelease", "campaignPass", "campaignReroll", "campaignUpgrade", "campaignStyle", "campaignRename"]) {
    await refused(anon.call(name, {}), /Sign in/);
  }
});

test("direct database access: no reading other studios, no writes anywhere, no listing", { skip }, async () => {
  const a = await player("a"), b = await player("b");
  await a.call("campaignStart", {});
  await b.call("campaignStart", {});
  await Fs.getDoc(Fs.doc(a.db, "campaigns", a.uid)); // own read works
  await denied(Fs.getDoc(Fs.doc(a.db, "campaigns", b.uid)));
  await denied(Fs.getDocs(Fs.collection(a.db, "campaigns")));
  await denied(Fs.getDocs(Fs.collection(a.db, "campaigns", b.uid, "films")));
  await denied(Fs.getDocs(Fs.collection(a.db, "users", b.uid, "runs")));
  await denied(Fs.setDoc(Fs.doc(a.db, "campaigns", a.uid), { bank: 1e9 }, { merge: true }));
  await denied(Fs.updateDoc(Fs.doc(a.db, "campaigns", a.uid), { "unlocked.actorTier": "A" }));
  await denied(Fs.deleteDoc(Fs.doc(a.db, "campaigns", b.uid)));
  await denied(Fs.setDoc(Fs.doc(a.db, "campaignBoard", a.uid), { displayName: "Me", filmsToATier: 1, bailouts: 0, lifetimeProfit: 9e9 }));
  await denied(Fs.setDoc(Fs.doc(a.db, "boards", "r3-basic-easy_2026-10-20", "entries", a.uid), { profit: 9999 }));
  await denied(Fs.setDoc(Fs.doc(a.db, "users", a.uid, "runs", "x"), { profit: 9999 }));
  await denied(Fs.setDoc(Fs.doc(a.db, "anything", "else"), { x: 1 }));
});

test("storage: no writing other studios' images, no non-images, no other paths, no listing", { skip }, async () => {
  const a = await player("a"), b = await player("b");
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  await St.uploadBytes(St.ref(a.st, `studios/${a.uid}/logo`), png, { contentType: "image/png" });
  await denied(St.uploadBytes(St.ref(b.st, `studios/${a.uid}/logo`), png, { contentType: "image/png" }));
  await denied(St.deleteObject(St.ref(b.st, `studios/${a.uid}/logo`)));
  await denied(St.uploadBytes(St.ref(a.st, `studios/${a.uid}/logo`), png, { contentType: "image/svg+xml" }));
  await denied(St.uploadBytes(St.ref(a.st, `studios/${a.uid}/logo`), png, { contentType: "text/html" }));
  await denied(St.uploadBytes(St.ref(a.st, `studios/${a.uid}/payload.html`), png, { contentType: "image/png" }));
  await denied(St.uploadBytes(St.ref(a.st, `studios/${a.uid}/logo/extra`), png, { contentType: "image/png" }));
  await denied(St.uploadBytes(St.ref(a.st, `public/${a.uid}`), png, { contentType: "image/png" }));
  await denied(St.uploadBytes(St.ref(a.st, `studios/${a.uid}/backdrop`), new Uint8Array(1501 * 1024), { contentType: "image/jpeg" }));
  await denied(St.listAll(St.ref(a.st, "studios")));
  await denied(St.listAll(St.ref(a.st, `studios/${a.uid}`)));
});

test("callables: prototype keys, wrong types and oversized input are refused or cleaned", { skip }, async () => {
  const a = await player("a");
  const st = (await a.call("campaignStart", { studioName: "<img src=x onerror=alert(1)>\u0000‮" + "W".repeat(5000) })).state;
  assert.ok(!/[<>\u0000]/.test(st.studioName) && st.studioName.length <= 30, "studio name cleaned: " + st.studioName);
  const index = st.currentProject.index;
  for (const g of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    await refused(a.call("campaignRelease", { index, pick: { g, d: "x", a1: "x", a2: "x", a3: "x", w: "summer" } }), /Unknown genre/);
    await refused(a.call("campaignReroll", { index, g }));
  }
  for (const id of ["__proto__", "constructor", "scout ", ["scout"], { id: "scout" }]) await refused(a.call("campaignUpgrade", { id }), /Unknown upgrade|Not enough/);
  for (const color of ["__proto__", "#ff0000", ["green"], { id: "green" }]) await refused(a.call("campaignStyle", { color }), /Unknown studio colour/);
  for (const idx of ["0", 0.5, -1, 1e12, null, [0], { valueOf: 0 }]) await refused(a.call("campaignRelease", { index: idx, pick: {} }), /no longer current|No film/);
  await refused(a.call("campaignRelease", { index, pick: "horror" }), /No film/);
  await refused(a.call("campaignRelease", { index, pick: [1, 2, 3] }));
  const big = "x".repeat(200000);
  const styled = (await a.call("campaignStyle", { tagline: big, city: { toString: "Lisbon" } })).state.profile;
  assert.equal(styled.tagline.length, 60);
  assert.equal(styled.city, "");
  await refused(a.call("campaignStyle", { logo: true }), /didn't finish uploading/);
  const urlTry = (await a.call("campaignStyle", { logo: "https://evil.example/x.png", backdrop: "javascript:alert(1)" })).state.profile;
  assert.equal(urlTry.logo, undefined, "a URL is never stored as the logo");
  assert.equal(urlTry.backdrop, undefined);
});

test("tampered campaign picks: locked genres, off-shortlist people, over budget, wrong release slot", { skip }, async () => {
  const a = await player("a");
  const st = (await a.call("campaignStart", {})).state, pj = st.currentProject, index = pj.index;
  const g = Object.keys(pj.genres).find((x) => pj.genres[x].state === "ok"), gs = pj.genres[g];
  const ok = { g, d: gs.dirs[gs.dirs.length - 1], a1: gs.pools.a1[5], a2: gs.pools.a2[5], a3: gs.pools.a3[5], w: "val" };
  await refused(a.call("campaignRelease", { index, pick: { ...ok, g: "animation" } }), /hasn't unlocked/);
  await refused(a.call("campaignRelease", { index, pick: { ...ok, d: "spielberg" } }), /director/);
  await refused(a.call("campaignRelease", { index, pick: { ...ok, a1: "dicaprio" } }), /cast/);
  await refused(a.call("campaignRelease", { index, pick: { ...ok, a1: ok.a2 } }), /cast/);
  await refused(a.call("campaignRelease", { index, pick: { ...ok, w: "winter" } }), /release slot/);
  await refused(a.call("campaignRelease", { index, pick: { ...ok, w: "2026-12-25" } }), /release slot/);
  await refused(a.call("campaignProject", { index, hard: true }), /unlock/);
  await refused(a.call("campaignReroll", { index, g }), /unlock at studio level/);
  await refused(a.call("campaignUpgrade", { id: "reputation" }), /Not enough/);
});

test("races: concurrent releases count once, passes and points can't be double-spent", { skip }, async () => {
  const a = await player("a");
  let st = (await a.call("campaignStart", {})).state;
  const pj = st.currentProject, g = Object.keys(pj.genres).find((x) => pj.genres[x].state === "ok"), gs = pj.genres[g];
  const lo = (ids) => ids[ids.length - 1]; // shortlists are sorted dearest first
  const pick = { g, d: lo(gs.dirs), a1: lo(gs.pools.a1), a2: lo(gs.pools.a2), a3: lo(gs.pools.a3), w: "val" };
  const outs = await Promise.allSettled(Array.from({ length: 6 }, () => a.call("campaignRelease", { index: pj.index, pick })));
  const ok = outs.filter((o) => o.status === "fulfilled").map((o) => o.value);
  st = (await a.call("campaignProject", {})).state;
  assert.equal(st.filmsMade, 1, "six concurrent releases of one project make one film");
  assert.ok(ok.every((o) => o.film.profit === ok[0].film.profit), "every answer reports the same film");
  // One pass, five concurrent pass requests.
  const passes = st.passesAvailable;
  const ps = await Promise.allSettled(Array.from({ length: 5 }, () => a.call("campaignPass", { index: st.currentProject.index })));
  const st2 = (await a.call("campaignProject", {})).state;
  assert.equal(passes - st2.passesAvailable, 1, "only one pass spent");
  assert.equal(st2.projectIndex, st.projectIndex + 1, "the project moved on once");
  assert.equal(ps.filter((o) => o.status === "fulfilled").length, 1);
});

test("the daily release refuses forged days, stories and shortlists", { skip }, async () => {
  const a = await player("a");
  const today = new Date().toISOString().slice(0, 10);
  await refused(a.call("release", { type: "basic", diff: "easy", day: "2030-01-01", pick: {} }), /closed/);
  await refused(a.call("release", { type: "ranked", diff: "easy", day: today, pick: {} }), /mode/);
  await refused(a.call("release", { type: "basic", diff: "__proto__", day: today, pick: {} }), /difficulty/);
  await refused(a.call("release", { type: "basic", diff: "easy", day: today, pick: { g: "constructor" } }), /genre/);
  await refused(a.call("release", { type: "basic", diff: "easy", day: today, pick: { g: "horror", s: 99 } }), /story/);
});

test("uploads: a file labelled image/png that isn't one is refused and deleted", { skip }, async () => {
  const a = await player("a");
  await a.call("campaignStart", {});
  const html = new TextEncoder().encode("<html><script>alert(document.domain)</script></html>".padEnd(64, " "));
  await St.uploadBytes(St.ref(a.st, `studios/${a.uid}/logo`), html, { contentType: "image/png" });
  await refused(a.call("campaignStyle", { logo: true }), /isn't a real image/);
  await assert.rejects(St.getMetadata(St.ref(a.st, `studios/${a.uid}/logo`)), /object-not-found/, "the fake image was deleted");
});

test("rate limits: a client hammering the slow real-dates switch gets turned away", { skip }, async () => {
  const a = await player("a");
  const st = (await a.call("campaignStart", {})).state;
  const outs = [];
  for (let i = 0; i < 9; i++) outs.push(await a.call("campaignProject", { index: st.currentProject.index, hard: true }).then(() => "ok", (e) => e.code));
  assert.ok(outs.slice(0, 6).every((c) => c === "functions/failed-precondition"), "the first six reach the function: " + outs);
  assert.ok(outs.slice(6).every((c) => c === "functions/resource-exhausted"), "then the player is slowed down: " + outs);
});
