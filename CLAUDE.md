# GREENLIGHT

A daily movie-studio game. Each day every player gets the same budget and market, picks a genre, gets a pitch, chooses a director, three actors (lead, supporting, villain) and a release window, and the model simulates the box office. **Score = 40% studio share of gross − total cost.** Spending the most must not win; fit between story, cast, timing and budget does.

Real directors and actors are game pieces. All fees, star ratings and dollar figures are invented game numbers, never real pay or box office.

## How it plays (do not change)
- **Modes:** Basic × {Easy, Medium, Hard} and Daily Challenge.
  - Easy: all stats, boosts and a projected profit visible.
  - Medium: everything about scoring hidden until release; player assigns lead vs. supporting.
  - Hard: hidden, plus a real calendar release date (Fridays) competing against real upcoming films (slate).
  - Daily Challenge: always Hard, one shared genre and pitch for everyone.
- Every mode and day has its own profit leaderboard; a player's best run of the day counts.
- **Paged wizard, one step per screen:** Genre → Pitch → Director → Lead → Supporting → Villain → Release → Review → Result.
- **Shortlists:** each cast role gets a seeded shortlist of 6 (3 men, 3 women), nobody repeated across roles (`poolsFor`).

## Layout
- `Frontend/greenlight.html`: the game (vanilla HTML/CSS/JS, no build step). The model sits between `// ===== MODEL START =====` and `// ===== MODEL END =====`; the UI comes after it.
- `data/*.json`: game data (genres, directors, actors, plots, windows, loyal, chem, slate). Loaded at boot and passed to `initModel()`. LOYAL/CHEM/SLATE are objects in JSON and converted back to the tuples the model uses.
- `reference/greenlight.v1.html`: frozen original single-file prototype. **Never edit.** Parity tests compare against it.
- `tools/model_loader.mjs`: loads the model section of an HTML file into a node `vm` context (used by tests and tools).
- `tools/extract_data.mjs`: one-off that produced `data/*.json` from the reference file.
- `tools/fetch_images.mjs`: looks up TMDB images locally (key from env/.env) and writes `data/images.json` (public image paths only, never the key). The page loads it optionally and falls back to initials.
- UI: dark, flat (no gradients), Big Shoulders Display / Instrument Sans / JetBrains Mono. Top bar = mode, difficulty, budget, leaderboard drawer; left rail = the wizard steps with what was picked. Director and cast pick from a horizontal reel. The budget meter colours by money left: red under $15M, orange under $40M, green otherwise. Step changes use the View Transitions API; honour prefers-reduced-motion.
- `Frontend/net.js`: Firebase module (auth, release call, live boards). Missing config = offline play, results kept on the device.
- `functions/`: Cloud Functions (`game.js` = server check, `index.js` = `release`). `firestore.rules`, `firebase.json` at the root.
- `tests/js/`: node tests (`node --test tests/js/*.test.mjs`). The parity test feeds the current model v1's own embedded data (model-code parity); `data_and_blends.test.mjs` checks the live data, blends and evalFast/evalFilm sync.

## Model
gross = genre base × daily genre heat × window multiplier × rival/competition factor × director skill × star power × (1 + synergies) × seeded luck (0.92–1.08).
Blended genres (`mix: [a, b]` in genres.json, e.g. Horror-Comedy) have their own base/cost and pitches; heat and window fit are the average of the halves, and a person, director specialty or rival film matches if it matches either half (`partsOf`, `inGenre`, `winG`). Only plain genres draw heat from the seed, so adding blends never moves a day's budget or rival.
Deterministic: seeded by the date via FNV-1a `hash` and mulberry32 `rng` (uses `Math.imul` and `>>>0`). Any port must match bit-for-bit; note JS `Math.round` ≠ Python `round`.
`bestPossible` exhaustively searches director × window/date × three shortlists within budget for one genre; `evalFast` is its lean twin of `evalFilm` and must stay in sync.

## Rules
- Determinism: everything for a day derives from the date (plus roster version, once the backend exists). Never mutate a published puzzle.
- Never reveal scoring before release on Medium/Hard: no heat, multipliers, tone tags, star ratings, synergies or projections.
- Never trust the client (from Phase 2): the server re-derives shortlists and budget and scores the film.
- Keep the paged flow and the shortlist system intact.
- Small commits, tests for every phase. Flag any guessed formula to the user.

## Roadmap (stop after each phase for approval)
1. **Extract data** to `data/*.json`. ✅
2. ~~FastAPI port~~ replaced (Oct 2026, user's choice) by Firebase: Auth (Google + email/password), a `release` Cloud Function that re-checks and re-scores with the page's own JS model, Firestore boards. Remaining from the old plan: nightly puzzle generator, roster versioning per day.
   Old plan, kept for reference: **Port scoring** to `backend/scoring.py` (FastAPI, Python 3.12) with a node↔Python parity test (≥500 picks, all modes, 10 days, 1e-6). Schema (Postgres, SQLite for dev, Alembic): `people`, `roster_snapshots`, `daily_puzzles`, `scores`. Endpoints `GET /daily`, `POST /release`, `GET /leaderboard`, `GET /actors/{id}`. Anonymous signed device id. Nightly puzzle generator.
3. **TMDB ingest** (server-side only, key from env/.env, never committed or sent to the client): ~125 actors (≥60 women, ≥60 men) + ~25 directors, derived stats documented in `docs/derivation.md`, approved overrides in `data/overrides.json` always win, immutable weekly snapshots, calibration gate.
4. **Hardening:** rate limits, CORS, validation, structured logs, `/health`, Redis rank cache behind a flag (off by default), deployment notes. No deploying.

## Decisions agreed with the user
1. Offline fallback is Easy-only practice, unranked; the scoring JS leaves the main page in Phase 2.
2. A puzzle row stores shortlists and plots for every genre, blends included (Basic), or one (Daily).
3. Daily Challenge is always Hard; the difficulty toggle is hidden there.
4. Directors get a seeded 8-person shortlist per day and genre once the roster grows past 8.
5. Qualitative hints (Buzzing/Cold, Audiences want, rival window) only on Easy.
6. The puzzle day is the UTC date.
7. Page has a proper doctype/charset/viewport (done in Phase 1).
8. TMDB gender 0/3 are left out of the roster and reported; `seed_people.json` can set gender by hand.
9. Backend is Firebase (not FastAPI): the page signs in with Firebase Auth; `functions/` `release` callable validates the pick against that UTC day's shortlists (directors via `dirsFor`, cast via `poolsFor`), budget and window, scores it with the model copied from the page (`tools/build_functions.mjs` → `functions/gen/`), and keeps each player's best film per board in `boards/{r3-type-diff_day}/entries/{uid}` and `users/{uid}/runs/{board}`. Only the function writes; rules allow public board reads and owner-only run reads.
10. Directors: seeded shortlist of 8 per day and genre (`dirsFor`), specialists nudged in.
11. A landing page explains the rules on first visit (localStorage `greenlight.intro.v1`) and from the How to play button; it must stay qualitative (no hidden numbers).

## Commands
- Play locally: `python -m http.server 8000` from the repo root, open http://localhost:8000/ (redirects to the game; opening the file directly cannot load the JSON).
- JS tests: `node --test tests/js/*.test.mjs`
- Refresh TMDB images: `node tools/fetch_images.mjs` (`--refresh` to redo all)
- Firebase: `node tools/firebase_setup.mjs` (writes `Frontend/firebase-config.js` + `.firebaserc` from `.env`), `npm --prefix functions install`, then `node tools/build_functions.mjs && firebase emulators:start` (needs JDK 21+). The page uses the real project; add `?emu` to the URL to use the emulators. Deploy: `firebase deploy --only functions,firestore` (Blaze plan).
