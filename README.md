# GREENLIGHT

A daily movie-studio game: same budget and market for everyone, greenlight one film, score is net profit.

Status: Phase 1 of 4 (game data extracted to `data/*.json`). The backend, TMDB ingest and hardening come next. See `CLAUDE.md`.

## Run it locally

The page loads its data with `fetch`, so it must be served over HTTP. Opening the file directly shows a "could not load the game data" message.

```sh
# from the repo root (Python 3.x)
python -m http.server 8000
```

Then open http://localhost:8000/ (it redirects to `Frontend/greenlight.html`). Use `localhost`, not the `0.0.0.0` address Python prints.

Without the Claude artifact runtime the leaderboard falls back to this browser's localStorage.

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
5. Deploy: `firebase deploy --only functions,firestore` (Cloud Functions need the Blaze plan). `build_functions.mjs` runs automatically first.

Without `firebase-config.js` the game still runs; results stay on the device.
