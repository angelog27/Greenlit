# GREENLIGHT

A daily movie-studio game: same budget and market for everyone, greenlight one film, score is net profit.

Status: daily modes (Basic, Daily Challenge) and the Campaign run on Firebase. See `CLAUDE.md` for the design and roadmap.

## Run it locally

The page loads its data with `fetch`, so it must be served over HTTP. Opening the file directly shows a "could not load the game data" message.

```sh
# from the repo root (Python 3.x)
python -m http.server 8000
```

Then open http://localhost:8000/ (it redirects to `Frontend/greenlight.html`). Use `localhost`, not the `0.0.0.0` address Python prints.

Without Firebase configured (see below), Basic and Daily results stay in this browser's localStorage; the Campaign needs the server.

## Tests

Requires Node 20 or newer.

```sh
node --test tests/js/*.test.mjs
```

`tests/js/phase1_data_parity.test.mjs` loads the model from the current page with `data/*.json` and from the frozen original (`reference/greenlight.v1.html`), then checks:

- the constants match
- the daily environments and shortlists match
- 900 random picks over 10 days and all three difficulties score identically
- the best-possible search returns identical results

The other test files check the live data and blends (`data_and_blends`), the `release` function's server check (`server_check`), the campaign rules (`campaign`: unlocks, bailouts, shortlists, feasibility over 200 projects, idempotent release, scoring parity with the page; takes about 2 minutes) and the Firestore rules (`rules`, emulator only).

## Data files

| File                  | Contents                                                                          |
| --------------------- | --------------------------------------------------------------------------------- |
| `data/genres.json`    | 8 genres: base potential and production cost                                      |
| `data/directors.json` | directors: fee, skill, specialty genres, tone tags                                |
| `data/actors.json`    | actors: gender, fee, star rating, genres, tone tags                               |
| `data/plots.json`     | three pitches per genre with the tones, roles and seasons they want               |
| `data/windows.json`   | release windows: marketing cost and genre multipliers                             |
| `data/loyal.json`     | director + actor reunion bonuses, with the films they made together               |
| `data/chem.json`      | actor + actor chemistry bonuses, with the films they shared                       |
| `data/slate.json`     | real upcoming releases (Hard mode): date, title, our genre tag, our 1–10 strength |
| `data/images.json`    | TMDB image paths for people, genre stills and slate posters (generated, optional) |
| `data/campaign.json`  | Campaign progression: bank, floor, caps, tiers, unlock ladder, passes             |
| `data/achievements.json` | Campaign gate names and badges                                                 |

All fees, ratings and dollar amounts are invented game numbers.

See [`data/README.md`](data/README.md) for every field, how each file is sorted, and how to find someone. After editing data, run `node tools/format_data.mjs` to re-sort and re-align it.

## Images (TMDB)

Portraits, genre stills and slate posters come from `data/images.json`, which holds only public `image.tmdb.org` paths. The page never sees the API key. To (re)build it after adding people or slate films:

```sh
node tools/fetch_images.mjs            # fills in anything missing
node tools/fetch_images.mjs --refresh  # re-looks up everything
```

The key is read from `TMDB_API_KEY` in the environment, `.env` or `Frontend/.env`. Entries can be edited by hand (for example to fix a wrong match). Anything without an image shows initials.


## Accounts and leaderboards (Firebase)

Players sign in with Google or email/password (Firebase Auth). When they release a film, the `release` Cloud Function rebuilds that day from the date, checks every pick was really on the day's shortlists and within budget, scores it with the same model code as the page, and keeps the player's best film of the day on the board. Boards: the Daily Challenge, plus one per Basic difficulty, reset every day at midnight UTC.

1. Put the Firebase **web** config in `.env` (`apiKey`, `authDomain`, `projectId`, `appId`, ...) and run `node tools/firebase_setup.mjs`. It writes `Frontend/firebase-config.js` (git-ignored) and `.firebaserc`.
2. In the Firebase console, enable the Google and Email/Password sign-in providers.
3. `npm --prefix functions install`
4. Local: `node tools/build_functions.mjs && firebase emulators:start` (needs JDK 21+), then serve the page as above. Add `?emu` to the page URL to use the emulators instead of the real project.
5. Deploy: `firebase deploy --only functions,firestore,storage` (Cloud Functions need the Blaze plan; create the Storage bucket once in the console under Storage → Get started). `build_functions.mjs` runs automatically first.

Without `firebase-config.js` the game still runs; results stay on the device.

### Emulators and the rules test

The emulators need JDK 21 or newer. If your default `java` is older, point `JAVA_HOME` (and `PATH`) at a JDK 21 for that shell before `firebase emulators:start`. With the Firestore emulator running, `node --test tests/js/*.test.mjs` also runs `tests/js/rules.test.mjs` (clients can't write campaigns or boards); with the Storage emulator too (`--only auth,functions,firestore,storage`) it also checks the studio-image rules. Without them those tests are skipped.

## Campaign

A self-paced solo career, separate from the daily modes. Pick **Campaign** in the mode switch (you need to be signed in; the studio lives on your account, so you can continue on any device).

- You run one studio over many films. Each film uses the same paged flow (genre, pitch, director, three parts, release), limited to what your studio has unlocked.
- The budget comes from your **bank**: profit goes back in, and the next budget is the bank, clamped between a floor and a cap for your highest unlocked tier. Fall below the floor and the studio is bailed out (counted, never game over).
- **Lifetime profit** (profitable films only, so it never drops) unlocks better cast and directors, new genres, bigger budgets and finally real release dates.
- The first 3 films show every number (Easy); after that numbers stay hidden until release (Medium).
- A pass skips the current pitches for a $5M development fee; you earn one every 3 films.
- A **studio level** grows with lifetime box office (every film teaches you something, flops included). Each level gives an upgrade point: scouting that shows who fits the genre and the part, reunions and chemistry, story notes, market research, test screenings, and Reputation and Marketing Deals discounts.
- 20 achievements, most with bronze, silver and gold tiers, shown as a medal row under your studio name; new ones animate in. Genre Master (3 profitable films in one genre) adds +3% box office in that genre.
- Customize your studio: logo and backdrop images (uploaded to Firebase Storage), a colour, a tagline and a home city. Your logo, name and colour show on the campaign board.
- The campaign board ranks studios by how few films they needed to reach the A-list (then fewer bailouts, then more lifetime profit), shown by studio name.

Everything is decided on the server: the `campaignStart`, `campaignProject`, `campaignRelease`, `campaignPass`, `campaignUpgrade`, `campaignStyle` and `campaignRename` callables (`functions/campaign.js` for the rules, `functions/campaign_store.js` for the transactions). The page reads your studio once per load and the film history only when you open it.

### Tuning

All campaign numbers are in `data/campaign.json` (bank, floor, caps, tier thresholds, unlock ladder, passes, levels, upgrades) and `data/achievements.json` (gate names, badges and their numbers). Every field is described in [`data/README.md`](data/README.md). After changing them:

```sh
node tools/campaign_report.mjs                 # how many actors/directors each tier has, loans needed per step
node tools/campaign_sim.mjs --runs 50          # films to each unlock for random and decent play, bailouts
node tools/campaign_sim.mjs --config my.json   # try numbers without editing the real file
node --test tests/js/campaign.test.mjs
```

Then deploy as above (`build_functions.mjs` copies both files to the functions).
