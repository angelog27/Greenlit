// Builds the public website into dist/ for Cloudflare Pages (or any static host): only the game page, its
// scripts and data, plus security headers. Nothing else from the repo (tools, functions, tests) is published.
//   Cloudflare Pages: build command `node tools/build_site.mjs`, output directory `dist`.
// The Firebase web config (public by design, not a secret) comes from the FIREBASE_CONFIG environment
// variable (the JSON object from the Firebase console), or else from a local Frontend/firebase-config.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist");
const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), path.join(OUT, rel)); };

fs.rmSync(OUT, { recursive: true, force: true });
["index.html", "Frontend/greenlight.html", "Frontend/net.js", "Frontend/favicon.svg"].forEach(copy);
fs.readdirSync(path.join(ROOT, "data")).filter((f) => f.endsWith(".json")).forEach((f) => copy("data/" + f));

let cfg = null;
if (process.env.FIREBASE_CONFIG) {
  try { cfg = JSON.parse(process.env.FIREBASE_CONFIG); } catch (e) { throw new Error("FIREBASE_CONFIG is not valid JSON: " + e.message); }
  for (const k of ["apiKey", "authDomain", "projectId", "storageBucket", "appId"]) if (!cfg[k]) throw new Error("FIREBASE_CONFIG is missing " + k);
  fs.writeFileSync(path.join(OUT, "Frontend/firebase-config.js"), "// Public Firebase web config (not a secret).\nwindow.FIREBASE_CONFIG = " + JSON.stringify(cfg, null, 2) + ";\n");
} else if (fs.existsSync(path.join(ROOT, "Frontend/firebase-config.js"))) {
  copy("Frontend/firebase-config.js");
  cfg = "local file";
} else {
  console.warn("No FIREBASE_CONFIG: the site will run offline (no sign-in, boards or campaign).");
}

// Security headers (Cloudflare Pages reads _headers). The page uses one inline script and inline image
// handlers, so scripts allow 'unsafe-inline'; everything else is limited to the services the game talks to.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://image.tmdb.org https://firebasestorage.googleapis.com https://*.googleusercontent.com",
  "connect-src 'self' https://*.googleapis.com https://*.cloudfunctions.net https://*.run.app https://firebasestorage.googleapis.com",
  "frame-src https://*.firebaseapp.com https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
fs.writeFileSync(path.join(OUT, "_headers"), `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Frame-Options: DENY
`);
console.log(`dist ready (${fs.readdirSync(path.join(OUT, "data")).length} data files, Firebase config: ${cfg ? (typeof cfg === "string" ? cfg : "from FIREBASE_CONFIG") : "none"})`);
