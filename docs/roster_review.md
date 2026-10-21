# Roster review (October 2026)

Proposed fixes to `data/directors.json` and `data/actors.json` so the game's talent matches who these people are. **Nothing here has been applied.** Go through it, change or strike anything, add your own, and send it back; I'll apply what you approve and re-run the balance checks.

How it plays in the game since 2026-10-22: a director's **skill** counts in full only in their specialty genres (`spec`), 60% in related genres and 25% elsewhere; an actor's **star** power counts in full in their genres (`g`), 85% in related ones, 65% elsewhere. So getting `spec` and `g` right now matters much more than before. Related genres: Action ~ Sci-Fi, Thriller · Sci-Fi ~ Action, Thriller, Horror · Animation ~ Comedy · Comedy ~ Romance, Animation · Horror ~ Thriller, Sci-Fi · Thriller ~ Horror, Action, Drama, Sci-Fi · Drama ~ Romance, Thriller · Romance ~ Drama, Comedy.

Mark each line: **✓** keep the proposal, **✗** reject, or write your own change.

## Directors

| Director | Now: specialties · tones · skill | Proposal | Why | Your call |
| --- | --- | --- | --- | --- |
| Steven Spielberg | sci-fi, action · epic, heartfelt · 1.25 | add **drama** | Schindler's List, Lincoln, The Fabelmans | |
| Christopher Nolan | action, sci-fi · epic, gritty · 1.25 | add **thriller** | Memento, The Prestige, Insomnia | |
| Ryan Coogler | action, drama · epic, gritty · 1.20 | add **horror** | Sinners | |
| Guillermo del Toro | horror, drama · eerie, stylish · 1.20 | add **animation** | Pinocchio (Oscar for animated feature) | |
| Jordan Peele | horror, comedy · eerie, funny · 1.20 | add **thriller** (and maybe sci-fi) | Get Out, Us, Nope | |
| Martin Scorsese | drama, thriller · gritty, epic · **1.10** | skill **1.20** (B-list) | one of the most celebrated directors working; 1.10 undersells him | |
| James Wan | horror, thriller · eerie, gritty · 1.10 | add **action** | Furious 7, Aquaman | |
| Yorgos Lanthimos | comedy, drama · stylish, eerie · 1.15 | keep (maybe add sci-fi: Bugonia) | | |
| Others | | keep as they are | specialties and tones already fit | |

**Gaps in the director pool:**
- **Animation** has only Pete Docter (plus del Toro if you approve above). Suggest adding one or two animation directors (e.g. Brad Bird, Chris Sanders, Domee Shi).
- **Romance** has Chazelle, Chu and Gluck. One more romance/drama director would help (e.g. Greta Gerwig is comedy/drama; consider Celine Song or Richard Linklater).
- **D-list directors** (skill 1.10 or below) are where every campaign starts; more variety there makes early films feel different.

## Actors

| Actor | Now: genres · tones · star / fee | Proposal | Why | Your call |
| --- | --- | --- | --- | --- |
| Leonardo DiCaprio | action, sci-fi, thriller, drama, romance · epic, stylish, gritty · 10 / $30 | drop **action** | almost no straight action roles; five genres makes him top almost everywhere | |
| Ryan Gosling | drama, comedy, sci-fi, action · stylish, heartfelt | add **romance** | The Notebook, La La Land, Crazy Stupid Love | |
| Emily Blunt | action, sci-fi, thriller, drama · gritty, heartfelt | add **horror** | A Quiet Place I and II | |
| Robert Pattinson | thriller, sci-fi, drama · gritty, stylish | add **horror** | The Lighthouse | |
| Jack Black | comedy, animation, **horror** · funny, heartfelt | horror → **action** | Jumanji, A Minecraft Movie; no notable horror | |
| Jenna Ortega | horror, comedy · eerie, funny · **5 / $6** | star **7**, fee ~$14 | a major draw now (Wednesday, Scream, Beetlejuice Beetlejuice); star 5 makes her the cheapest pick in the game | |
| Willem Dafoe | horror, drama, thriller · eerie, stylish · 8 / **$14** | fee ~$20 | star 8 at $14 is a big bargain compared with every other 8 | |
| Awkwafina | comedy, animation · funny, heartfelt · 6 / $9 | star **7** | The Farewell, Shang-Chi, Crazy Rich Asians | |
| Winston Duke | action, horror, comedy · epic, eerie · 5 / $8 | keep or star 6 | | |
| Others | | keep | genres and tones already fit | |

**Gaps in the actor pool:**
- **D-list men** (star 5 or 6): only 4 today, so early campaign shortlists borrow C-list men "on loan". Adding about 5 more would remove the loans (any up-and-comers you like).
- **A-list women** (star 9+): only Scarlett Johansson. Consider raising one or two established stars (e.g. Margot Robbie, Zendaya, Emma Stone, Viola Davis) to 9, with fees to match.

## How to send it back

Edit this file (or reply in chat) with your decisions. Once applied I'll run `node tools/format_data.mjs`, the tests, `node tools/campaign_report.mjs` (tier coverage) and the pacing simulation, and tell you if any change moves the balance.
