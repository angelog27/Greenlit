// Looks up TMDB images for the game's people, genres and Hard-mode slate and writes data/images.json.
// Runs locally only. The key comes from TMDB_API_KEY (env, .env or Frontend/.env) and never leaves this
// script: images.json holds public image paths served by image.tmdb.org, which needs no key.
// Usage: node tools/fetch_images.mjs [--refresh]   (default keeps entries already in images.json)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "images.json");
const REFRESH = process.argv.includes("--refresh");

function readKey() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY.trim();
  for (const f of [".env", "Frontend/.env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*TMDB_API_KEY\s*=\s*["']?([^"'\s]+)/);
      if (m) return m[1];
    }
  }
  throw new Error("TMDB_API_KEY not found in env, .env or Frontend/.env");
}
const KEY = readKey();
// v3 keys are 32 hex chars and go in the query; anything longer is a v4 read token sent as a bearer.
const V4 = KEY.length > 40;

async function tmdb(p, params = {}) {
  const u = new URL("https://api.themoviedb.org/3" + p);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!V4) u.searchParams.set("api_key", KEY);
  for (let tries = 0; ; tries++) {
    const r = await fetch(u, { headers: V4 ? { Authorization: "Bearer " + KEY } : {} });
    if (r.status === 429 && tries < 4) { await new Promise((s) => setTimeout(s, 1000 * (tries + 1))); continue; }
    if (!r.ok) throw new Error(`TMDB ${p}: HTTP ${r.status}`);
    return r.json();
  }
}

const load = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", n + ".json"), "utf8"));
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const out = { base: "https://image.tmdb.org/t/p/", people: {}, genres: {}, slate: {} };
if (!REFRESH) for (const k of ["people", "genres", "slate"]) Object.assign(out[k], prev[k] || {});
const missing = [];

// People TMDB lists under a longer name.
const TMDB_NAME = { "Salma Hayek": "Salma Hayek Pinault", "Tony Leung": "Tony Leung Chiu-wai" };
async function person(id, name, dept) {
  if (out.people[id]?.profile) return;
  name = TMDB_NAME[name] || name;
  const res = (await tmdb("/search/person", { query: name })).results || [];
  const exact = res.filter((r) => r.name.toLowerCase() === name.toLowerCase() && r.profile_path);
  const pick = exact.find((r) => r.known_for_department === dept) || exact.sort((a, b) => b.popularity - a.popularity)[0];
  if (!pick) { missing.push("person " + name); return; }
  out.people[id] = { tmdb: pick.id, profile: pick.profile_path };
}

// Our genre id -> TMDB genre id. The still comes from the most-voted film in that genre.
const TMDB_GENRE = { action: 28, scifi: 878, animation: 16, comedy: 35, horror: 27, thriller: 53, drama: 18, romance: 10749 };
// Blends (genres with `mix`) ask TMDB for films tagged with every half (comma = AND).
async function genre(g) {
  const id = g.id;
  if (out.genres[id]?.backdrop) return;
  const ids = (g.mix || [id]).map((p) => TMDB_GENRE[p]);
  if (ids.some((x) => !x)) { missing.push("genre " + id + " (no TMDB genre mapping)"); return; }
  const res = (await tmdb("/discover/movie", { with_genres: ids.join(","), sort_by: "vote_count.desc", include_adult: "false" })).results || [];
  const used = new Set(Object.values(out.genres).map((x) => x.tmdb));
  const pick = res.find((r) => r.backdrop_path && !used.has(r.id));
  if (!pick) { missing.push("genre " + id); return; }
  out.genres[id] = { tmdb: pick.id, film: pick.title, backdrop: pick.backdrop_path };
}

async function slate(title, date) {
  if (out.slate[title]?.poster) return;
  const year = date.slice(0, 4);
  let res = (await tmdb("/search/movie", { query: title, primary_release_year: year })).results || [];
  if (!res.some((r) => r.poster_path)) res = (await tmdb("/search/movie", { query: title, year })).results || [];
  const pick = res.find((r) => r.poster_path);
  if (!pick) { missing.push("film " + title); return; }
  out.slate[title] = { tmdb: pick.id, poster: pick.poster_path };
}

for (const d of load("directors")) await person(d.id, d.name, "Directing");
for (const a of load("actors")) await person(a.id, a.name, "Acting");
for (const g of load("genres")) await genre(g);
for (const s of load("slate")) await slate(s.title, s.date);

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${path.relative(ROOT, OUT)}: ${Object.keys(out.people).length} people, ${Object.keys(out.genres).length} genres, ${Object.keys(out.slate).length} films`);
if (missing.length) console.log("no image found for:\n  " + missing.join("\n  "));
