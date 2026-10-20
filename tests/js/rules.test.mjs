// Firestore rules (firestore.rules): clients can read their own campaign and the public boards, and can never
// write a campaign, its films or the campaign board. Needs the Firestore emulator; skipped when it isn't running:
//   firebase emulators:start --only firestore,storage   (JDK 21+), then node --test tests/js/*.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
const up = await new Promise((done) => {
  const s = net.connect({ host, port: +port }, () => { s.destroy(); done(true); });
  s.on("error", () => done(false));
  s.setTimeout(500, () => { s.destroy(); done(false); });
});
const skip = up ? false : `Firestore emulator not running on ${host}:${port}`;
const [sHost, sPort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199").split(":");
const storageUp = await new Promise((done) => {
  const s = net.connect({ host: sHost, port: +sPort }, () => { s.destroy(); done(true); });
  s.on("error", () => done(false));
  s.setTimeout(500, () => { s.destroy(); done(false); });
});
const skipStorage = up && storageUp ? false : "Firestore and Storage emulators not both running";

let env, T;
before(async () => {
  if (!up) return;
  T = require("@firebase/rules-unit-testing");
  env = await T.initializeTestEnvironment({
    projectId: "demo-greenlight-rules",
    firestore: { host, port: +port, rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
    ...(storageUp ? { storage: { host: sHost, port: +sPort, rules: readFileSync(new URL("../../storage.rules", import.meta.url), "utf8") } } : {}),
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("campaigns/alice").set({ bank: 75 });
    await db.doc("campaigns/alice/films/00000").set({ profit: 10 });
    await db.doc("campaignBoard/alice").set({ displayName: "Studio ALICE", filmsToATier: 14 });
  });
});
after(async () => { if (env) await env.cleanup(); });

test("owners read their own campaign; nobody else does", { skip }, async () => {
  const alice = env.authenticatedContext("alice").firestore(), bob = env.authenticatedContext("bob").firestore();
  const anon = env.unauthenticatedContext().firestore();
  await T.assertSucceeds(alice.doc("campaigns/alice").get());
  await T.assertSucceeds(alice.doc("campaigns/alice/films/00000").get());
  await T.assertFails(bob.doc("campaigns/alice").get());
  await T.assertFails(bob.doc("campaigns/alice/films/00000").get());
  await T.assertFails(anon.doc("campaigns/alice").get());
});

test("clients can never write a campaign, its films or the board", { skip }, async () => {
  const alice = env.authenticatedContext("alice").firestore();
  await T.assertFails(alice.doc("campaigns/alice").set({ bank: 9999 }));
  await T.assertFails(alice.doc("campaigns/alice").update({ bank: 9999 }));
  await T.assertFails(alice.doc("campaigns/alice").delete());
  await T.assertFails(alice.doc("campaigns/alice/films/00001").set({ profit: 500 }));
  await T.assertFails(alice.doc("campaigns/bob").set({ bank: 1 }));
  await T.assertFails(alice.doc("campaignBoard/alice").set({ filmsToATier: 1 }));
  await T.assertFails(alice.doc("campaignBoard/alice").delete());
});

test("the campaign board is public to read", { skip }, async () => {
  const anon = env.unauthenticatedContext().firestore();
  const snap = await T.assertSucceeds(anon.collection("campaignBoard").get());
  assert.equal(snap.size, 1);
});

test("daily boards keep their rules", { skip }, async () => {
  const alice = env.authenticatedContext("alice").firestore();
  await T.assertSucceeds(alice.collection("boards/r3-basic-easy_2026-10-20/entries").get());
  await T.assertFails(alice.doc("boards/r3-basic-easy_2026-10-20/entries/alice").set({ profit: 1 }));
});

// Studio images: owner-only uploads of small images, public reads, nothing else in the bucket.
test("storage: only the owner uploads their studio's logo and backdrop, images only, size-capped", { skip: skipStorage }, async () => {
  const img = (kb) => new Uint8Array(kb * 1024);
  const meta = (type) => ({ contentType: type });
  const alice = env.authenticatedContext("alice").storage(), bob = env.authenticatedContext("bob").storage(), anon = env.unauthenticatedContext().storage();
  await T.assertSucceeds(alice.ref("studios/alice/logo").put(img(100), meta("image/png")));
  await T.assertSucceeds(alice.ref("studios/alice/backdrop").put(img(1200), meta("image/jpeg")));
  await T.assertFails(alice.ref("studios/alice/logo").put(img(401), meta("image/png")));
  await T.assertFails(alice.ref("studios/alice/backdrop").put(img(1501), meta("image/jpeg")));
  await T.assertFails(alice.ref("studios/alice/logo").put(img(10), meta("text/html")));
  await T.assertFails(alice.ref("studios/alice/other").put(img(10), meta("image/png")));
  await T.assertFails(bob.ref("studios/alice/logo").put(img(10), meta("image/png")));
  await T.assertFails(anon.ref("studios/alice/logo").put(img(10), meta("image/png")));
  await T.assertFails(alice.ref("anything/else").put(img(10), meta("image/png")));
  await T.assertSucceeds(anon.ref("studios/alice/logo").getDownloadURL());
  await T.assertFails(bob.ref("studios/alice/logo").delete());
  await T.assertSucceeds(alice.ref("studios/alice/backdrop").delete());
});
