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
- **Shortlists:** each cast role gets a seeded shortlist of 6 (3 men, 3 women), nobody repeated across roles (`poolsFor`). Each person draws from their own seed (day, genre, id), so actors.json/directors.json order never matters (changed Oct 2026, user's choice, so the files can be sorted).

## Campaign (solo career mode, Oct 2026)
One studio per account, self-paced, separate from the daily modes. All state is on the server (`campaigns/{uid}`); the page never keeps progress locally and asks signed-out players to sign in.
- **Money:** bank starts at `start.bank`; after each film bank += profit. Next budget = clamp(bank, floor, cap of the highest unlocked tier). Below the floor: bailout back to the floor, counted, run continues. Lifetime profit = sum of max(0, profit), never decreases.
- **Unlocks:** the `ladder` in `data/campaign.json` (lifetime profit thresholds) opens cast tiers, director tiers, genres and finally real release dates (Hard) per project. Tiers are derived from stats (`tiers.actorMinStar`, `tiers.directorMinSkill`), never hand-labelled.
- **Projects:** deterministic from hash(uid, campaignId, projectIndex) via `makeEnv(date, key)`. Shortlists (3 men + 3 women per role, no repeats, unlocked tiers only, at least 2 per role from the newest tier, loans from the next tier up when a gender runs short; directors 8 from unlocked tiers) are drawn on the server and stored in the project. Every playable genre must have a film within budget with profit >= `feasibility.margin` (checked with the model's own `bestPossible`, one director at a time); others show "Too pricey today".
- **Visibility:** Easy for the first `trainingFilms` films, then Medium; Hard per project once the last gate is open.
- **Passes:** skip the current pitches for a $5M fee, earned every 3 films.
- **Story rerolls (Oct 2026, user's choice):** `rerolls` in `data/campaign.json` (level 3: 2 per project, level 6: 4). `campaignReroll` swaps one playable genre's pitch on the current project, seeded by the project and the reroll count, skipping stories with no film over the feasibility margin. Nothing else rerolls.
- **Money display:** amounts of $1,000M and up show as billions (`money()`: $1.5B, $1.96B).
- **Levels and upgrades:** experience is lifetime box office (`lifetimeGross`, flops count); `levels` in `data/campaign.json` are the thresholds and each level after the first is one upgrade point, spent with `campaignUpgrade`. Upgrades (all numbers in `upgrades`): Talent Scout I-III (genre fit, tone fit, stars/skill), Casting Director (reunions, chemistry), Story Analyst (story tones/seasons), Market Research (heat, window fit, rival), Test Screenings (projected profit, min level 6), Reputation I-III (talent fees -5/10/15%), Marketing Deals I-II (marketing -15/30%). Discounts go through the model (`env.disc` → `talentFee`/`windowCost` in `costOf` and `bestPossible`) and apply to the current project at once.
- **Badges:** 20 in `data/achievements.json`, 12 with Bronze/Silver/Gold `tiers` (all thresholds there; `{n}` in a text is the tier's number, `(s)` pluralises). Evaluated on the server after each release and each upgrade from running `stats` (streak, reunions, chemistry, timing, seasons, real-date hits, bailedOut) or the film itself; stored as `badges[id] = { tier, at }` and fired again only at a higher tier. Genre Master adds +3% gross in that genre (`env.bonus`, a "Genre Master" step in evalFilm/evalFast). The HQ shows a compact medal row under the studio name and an Achievements panel with progress; new badges animate in (respecting reduced motion).
- **Studio look:** `campaignStyle` sets `profile` (palette `color` from `studioColors`, `tagline`, `city`, `logo`/`backdrop` versions). Images live in Storage at `studios/{uid}/logo|backdrop` (`storage.rules`: owner-only writes of JPEG/PNG/WebP under the size caps, public reads); the page crops and shrinks them first, and the function checks type and size before storing the version. The board row carries the logo and colour.
- **Board:** `campaignBoard/{uid}`, written once when the studio reaches `boardGoal`: fewest films, then fewer bailouts, then more lifetime profit. Shown by studio name (default "Studio XXXXX"), never the Google name.
- **Pacing (Oct 2026 sim with upgrades, 50 campaigns each):** random play reaches C-list cast in 4 films and the A-list in 40 (level 10 by then); decent play reaches the A-list in 14 (level 8) with no bailouts. Re-run `tools/campaign_sim.mjs` after changing the ladder, caps, floor or roster.

## Layout
- `Frontend/greenlight.html`: the game (vanilla HTML/CSS/JS, no build step). The model sits between `// ===== MODEL START =====` and `// ===== MODEL END =====`; the UI comes after it.
- `data/*.json`: game data (genres, directors, actors, plots, windows, loyal, chem, slate). Loaded at boot and passed to `initModel()`. LOYAL/CHEM/SLATE are objects in JSON and converted back to the tuples the model uses.
- `reference/greenlight.v1.html`: frozen original single-file prototype. **Never edit.** Parity tests compare against it.
- `tools/model_loader.mjs`: loads the model section of an HTML file into a node `vm` context (used by tests and tools).
- `tools/extract_data.mjs`: one-off that produced `data/*.json` from the reference file.
- `tools/format_data.mjs`: sorts actors (star), directors (skill), loyal/chem (grouped by person) and lays every simple data file out one record per line. Run after editing data. genres/windows/plots order is seed-relevant and kept. `data/README.md` documents fields and sort orders.
- `tools/fetch_images.mjs`: looks up TMDB images locally (key from env/.env) and writes `data/images.json` (public image paths only, never the key). The page loads it optionally and falls back to initials.
- UI: dark by default with a light theme (system or the top-bar toggle), flat (no gradients), Big Shoulders Display / Instrument Sans (no monospace/code font anywhere; numbers use tabular figures). Top bar = mode, difficulty, budget, leaderboard drawer; left rail = the wizard steps with what was picked. Director and cast pick from a horizontal reel. The budget meter colours by money left: red under $15M, orange under $40M, green otherwise. Step changes use the View Transitions API; honour prefers-reduced-motion.
- `Frontend/net.js`: Firebase module (auth, release call, live boards, campaign load/callables/history/board). Missing config = offline play for Basic and Daily, results kept on the device; the campaign needs the server.
- `functions/`: Cloud Functions (`game.js` = server check, `index.js` = `release` and the campaign callables, `campaign.js` = pure campaign rules, `campaign_store.js` = their Firestore transactions). `firestore.rules`, `storage.rules` (studio images), `firestore.indexes.json` (campaign board index), `firebase.json` at the root.
- `data/campaign.json`, `data/achievements.json`: campaign progression numbers and gates/badges (documented in `data/README.md`). Every campaign number lives there, not in code.
- `tools/campaign_report.mjs`: roster coverage per campaign tier and unlock step. `tools/campaign_sim.mjs`: pacing simulation (random and fit-rule policies).
- `tests/js/`: node tests (`node --test tests/js/*.test.mjs`). The parity test feeds the current model v1's own embedded data (model-code parity); `data_and_blends.test.mjs` checks the live data, blends and evalFast/evalFilm sync; `campaign.test.mjs` the campaign rules (about 2 minutes, mostly the 200-project feasibility check); `rules.test.mjs` the Firestore rules against the emulator (skipped when it isn't running).

## Model
gross = genre base × daily genre heat × window multiplier × rival/competition factor × director skill × star power × (1 + synergies) × seeded luck (0.92–1.08).
Blended genres (`mix: [a, b]` in genres.json, e.g. Horror-Comedy) have their own base/cost and pitches; heat and window fit are the average of the halves, and a person, director specialty or rival film matches if it matches either half (`partsOf`, `inGenre`, `winG`). Only plain genres draw heat from the seed, so adding blends never moves a day's budget or rival.
Deterministic: seeded by the date via FNV-1a `hash` and mulberry32 `rng` (uses `Math.imul` and `>>>0`). Any port must match bit-for-bit; note JS `Math.round` ≠ Python `round`.
`bestPossible` exhaustively searches director × window/date × three shortlists within budget for one genre; `evalFast` is its lean twin of `evalFilm` and must stay in sync.
Campaign hooks (absent in daily envs, so daily play is unchanged): `makeEnv(day, key)` seeds from `key`, `env.pools`/`env.dirs` replace `poolsFor`/`dirsFor`, `env.bonus[genre]` adds the Genre Master step, `env.disc` discounts fees (`talentFee`) and marketing (`windowCost`), rounded to whole $M.
Stories: six per genre. Basic players can shuffle among the day's pitches for a genre as often as they like (`plotChoices`, `envWithPlot`); the release sends the pitch as `pick.s` and the server checks it is one of them. The Daily Challenge keeps one shared story. A pitch with `from` (a date) only joins the draw from that UTC day, so adding pitches never changes a day already played. Append new ones with a `from` date at least a day ahead and deploy the functions before it. One scoring model serves Basic, Daily and Campaign; never fork it.

## Rules
- Determinism: everything for a day derives from the date (plus roster version, once the backend exists). Never mutate a published puzzle.
- Never reveal scoring before release on Medium/Hard: no heat, multipliers, tone tags, star ratings, synergies or projections. **Exception (user's choice, Oct 2026):** in the campaign, information upgrades the studio has bought reveal their part on hidden-number projects (`SEE()` in the page). Basic and Daily never change.
- Never trust the client (from Phase 2): the server re-derives shortlists and budget and scores the film.
- Keep the paged flow and the shortlist system intact.
- Small commits, tests for every phase. Flag any guessed formula to the user.
- Campaign: server-authoritative. Every write goes through `campaignStart`, `campaignProject`, `campaignRelease` (idempotent per project index, in a transaction), `campaignPass`, `campaignReroll`, `campaignUpgrade`, `campaignStyle`, `campaignRename`. Rules let a player read only their own campaign and anyone read the board; clients never write either. Tune pacing in `data/campaign.json` only, never by changing the scoring model.

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
12. Campaign (Oct 2026): start bank $75M, floor $70M, caps D $75M / C $95M / B $120M / A $150M (the proposed $45M couldn't pay for the cheapest D-list film, about $54M). Director D tier is skill <= 1.10 (9 directors instead of 2). D-list has only 4 men and 8 women, so men's (and one woman's) slots are filled "On loan" from the C-list until C-list actors unlock; adding D-list men to the roster removes the loans. Blends unlock with their halves (Horror-Comedy at the start). Blockbuster badge = profit >= $100M. Ladder tuned by simulation to $200M / $500M / $1,000M / $2,000M.
13. Light and dark themes app-wide: light tokens follow the system, a top-bar button cycles system/light/dark (localStorage `greenlight.theme`).

## Commands
- Play locally: `python -m http.server 8000` from the repo root, open http://localhost:8000/ (redirects to the game; opening the file directly cannot load the JSON).
- JS tests: `node --test tests/js/*.test.mjs` (start the Firestore emulator first to include the rules test)
- Campaign: `node tools/campaign_report.mjs` (tier coverage), `node tools/campaign_sim.mjs --runs 50` (pacing; `--config file.json` to try other numbers)
- Refresh TMDB images: `node tools/fetch_images.mjs` (`--refresh` to redo all)
- Firebase: `node tools/firebase_setup.mjs` (writes `Frontend/firebase-config.js` + `.firebaserc` from `.env`), `npm --prefix functions install`, then `node tools/build_functions.mjs && firebase emulators:start` (needs JDK 21+; set `JAVA_HOME` to a JDK 21 if the default Java is older). The page uses the real project; add `?emu` to the URL to use the emulators. Deploy: `firebase deploy --only functions,firestore,storage` (Blaze plan; also deploys the rules and the campaign board index). Storage needs its default bucket created once in the console (Storage → Get started). Emulators: add `storage` to `--only` for studio images.
