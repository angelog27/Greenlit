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

| File | Contents |
| --- | --- |
| `data/genres.json` | 8 genres: base potential and production cost |
| `data/directors.json` | directors: fee, skill, specialty genres, tone tags |
| `data/actors.json` | actors: gender, fee, star rating, genres, tone tags |
| `data/plots.json` | three pitches per genre with the tones, roles and seasons they want |
| `data/windows.json` | release windows: marketing cost and genre multipliers |
| `data/loyal.json` | director + actor reunion bonuses, with the films they made together |
| `data/chem.json` | actor + actor chemistry bonuses, with the films they shared |
| `data/slate.json` | real upcoming releases (Hard mode): date, title, our genre tag, our 1–10 strength |

All fees, ratings and dollar amounts are invented game numbers.
