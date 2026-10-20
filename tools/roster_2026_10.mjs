// One-off (Oct 2026): grows the roster to ~66 actors and 23 directors, with reunion (director + actor) and
// chemistry (actor + actor) bonuses taken only from films the people actually made together.
// Fees, star ratings, skills and bonuses are invented game numbers. Safe to re-run: existing ids are kept.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const P = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const rd = (n) => JSON.parse(fs.readFileSync(path.join(P, n + ".json"), "utf8"));
const wr = (n, v) => fs.writeFileSync(path.join(P, n + ".json"), JSON.stringify(v, null, 2) + "\n");

const A = (id, s, name, fee, star, g, tone, known) => ({ id, s, name, fee, star, g, tone, known });
const newActors = [
  A("yeoh", "f", "Michelle Yeoh", 18, 8, ["action", "drama", "scifi"], ["epic", "heartfelt"], "Everything Everywhere All at Once, Crouching Tiger, Hidden Dragon, Wicked"),
  A("erivo", "f", "Cynthia Erivo", 16, 7, ["drama", "romance", "thriller"], ["heartfelt", "epic"], "Wicked, Harriet, Widows"),
  A("grande", "f", "Ariana Grande", 18, 7, ["comedy", "romance", "animation"], ["funny", "heartfelt"], "Wicked, Wicked: For Good, Don't Look Up"),
  A("ferguson", "f", "Rebecca Ferguson", 18, 8, ["action", "scifi", "thriller"], ["stylish", "gritty"], "Mission: Impossible – Fallout, Dune, Doctor Sleep"),
  A("collette", "f", "Toni Collette", 12, 7, ["horror", "drama", "comedy"], ["eerie", "heartfelt"], "Hereditary, Little Miss Sunshine, Knives Out"),
  A("chastain", "f", "Jessica Chastain", 16, 7, ["drama", "thriller", "scifi"], ["gritty", "stylish"], "Zero Dark Thirty, Interstellar, Molly's Game"),
  A("comer", "f", "Jodie Comer", 14, 7, ["thriller", "drama", "comedy"], ["stylish", "funny"], "Free Guy, The Last Duel, 28 Years Later"),
  A("goth", "f", "Mia Goth", 8, 6, ["horror", "thriller"], ["eerie", "stylish"], "Pearl, X, Frankenstein"),
  A("ackie", "f", "Naomi Ackie", 8, 6, ["scifi", "drama", "thriller"], ["heartfelt", "gritty"], "Mickey 17, Blink Twice, I Wanna Dance with Somebody"),
  A("johansson", "f", "Scarlett Johansson", 28, 9, ["action", "scifi", "comedy"], ["stylish", "heartfelt"], "Black Widow, Jojo Rabbit, Jurassic World Rebirth"),
  A("thompson", "f", "Tessa Thompson", 14, 7, ["action", "scifi", "drama"], ["stylish", "heartfelt"], "Thor: Ragnarok, Creed, Annihilation"),
  A("olsen", "f", "Elizabeth Olsen", 16, 7, ["action", "thriller", "horror"], ["eerie", "heartfelt"], "Avengers: Endgame, Wind River, Godzilla"),
  A("taylorjoy", "f", "Anya Taylor-Joy", 18, 8, ["thriller", "horror", "action"], ["eerie", "stylish"], "Furiosa, The Menu, Last Night in Soho"),
  A("hall", "f", "Regina Hall", 10, 6, ["comedy", "romance"], ["funny", "heartfelt"], "Girls Trip, One Battle After Another, Support the Girls"),
  A("wu", "f", "Constance Wu", 8, 6, ["romance", "comedy"], ["heartfelt", "funny"], "Crazy Rich Asians, Hustlers"),
  A("rodriguez", "f", "Michelle Rodriguez", 14, 7, ["action", "thriller"], ["gritty", "epic"], "Fast & Furious 6, Avatar, Dungeons & Dragons: Honor Among Thieves"),
  A("davis", "f", "Viola Davis", 16, 8, ["drama", "thriller", "action"], ["gritty", "heartfelt"], "Fences, Widows, The Woman King"),
  A("hemsworth", "m", "Chris Hemsworth", 26, 8, ["action", "comedy", "scifi"], ["epic", "funny"], "Thor: Ragnarok, Extraction, Furiosa"),
  A("jordan", "m", "Michael B. Jordan", 22, 8, ["action", "drama", "horror"], ["gritty", "heartfelt"], "Creed, Black Panther, Sinners"),
  A("mescal", "m", "Paul Mescal", 14, 7, ["drama", "romance", "action"], ["heartfelt", "gritty"], "Aftersun, Gladiator II, All of Us Strangers"),
  A("elordi", "m", "Jacob Elordi", 14, 7, ["drama", "romance", "horror"], ["stylish", "eerie"], "Saltburn, Priscilla, Frankenstein"),
  A("plemons", "m", "Jesse Plemons", 12, 7, ["thriller", "drama", "comedy"], ["gritty", "eerie"], "Civil War, Kinds of Kindness, Bugonia"),
  A("butler", "m", "Austin Butler", 18, 8, ["drama", "action", "thriller"], ["stylish", "gritty"], "Elvis, Dune: Part Two, The Bikeriders"),
  A("yeun", "m", "Steven Yeun", 10, 6, ["drama", "horror", "scifi"], ["heartfelt", "eerie"], "Minari, Nope, Mickey 17"),
  A("ruffalo", "m", "Mark Ruffalo", 18, 8, ["drama", "comedy", "scifi"], ["heartfelt", "funny"], "Poor Things, Spotlight, Mickey 17"),
  A("dafoe", "m", "Willem Dafoe", 14, 8, ["horror", "drama", "thriller"], ["eerie", "stylish"], "The Lighthouse, Poor Things, Nosferatu"),
  A("washington", "m", "Denzel Washington", 28, 9, ["action", "thriller", "drama"], ["gritty", "stylish"], "Training Day, The Equalizer, Gladiator II"),
  A("damon", "m", "Matt Damon", 24, 8, ["action", "scifi", "drama"], ["gritty", "heartfelt"], "The Martian, The Bourne Identity, Oppenheimer"),
  A("pitt", "m", "Brad Pitt", 28, 9, ["action", "drama", "comedy"], ["stylish", "epic"], "F1, Once Upon a Time in Hollywood, Bullet Train"),
  A("phoenix", "m", "Joaquin Phoenix", 22, 8, ["drama", "thriller"], ["gritty", "eerie"], "Joker, Her, Eddington"),
  A("hiddleston", "m", "Tom Hiddleston", 14, 7, ["action", "horror", "drama"], ["stylish", "heartfelt"], "Thor: Ragnarok, Crimson Peak, The Life of Chuck"),
];

const D = (id, name, fee, skill, spec, tone, note, known) => ({ id, name, fee, skill, spec, tone, note, known });
const newDirs = [
  D("coogler", "Ryan Coogler", 26, 1.2, ["action", "drama"], ["epic", "gritty"], "Crowd-pleasing auteur", "Black Panther, Creed, Sinners"),
  D("wright", "Edgar Wright", 16, 1.1, ["comedy", "action"], ["funny", "stylish"], "Kinetic genre mash-ups", "Baby Driver, Shaun of the Dead, Hot Fuzz"),
  D("waititi", "Taika Waititi", 20, 1.1, ["comedy", "action"], ["funny", "heartfelt"], "Big-hearted irreverence", "Thor: Ragnarok, Jojo Rabbit, What We Do in the Shadows"),
  D("deltoro", "Guillermo del Toro", 24, 1.2, ["horror", "drama"], ["eerie", "stylish"], "Monster-loving craftsman", "The Shape of Water, Pan's Labyrinth, Frankenstein"),
  D("rscott", "Ridley Scott", 30, 1.15, ["scifi", "action"], ["epic", "gritty"], "Epic-scale veteran", "Alien, Gladiator, The Martian"),
  D("spielberg", "Steven Spielberg", 36, 1.25, ["scifi", "action"], ["epic", "heartfelt"], "The original blockbuster", "Jaws, Jurassic Park, E.T. the Extra-Terrestrial"),
  D("tarantino", "Quentin Tarantino", 32, 1.2, ["thriller", "action"], ["stylish", "gritty"], "Dialogue and bloodshed", "Pulp Fiction, Django Unchained, Once Upon a Time in Hollywood"),
  D("bong", "Bong Joon Ho", 22, 1.2, ["thriller", "scifi"], ["eerie", "funny"], "Genre-bending satirist", "Parasite, Snowpiercer, Mickey 17"),
  D("flanagan", "Mike Flanagan", 14, 1.1, ["horror", "drama"], ["eerie", "heartfelt"], "Heartfelt horror", "Doctor Sleep, Oculus, The Life of Chuck"),
  D("aster", "Ari Aster", 15, 1.1, ["horror", "drama"], ["eerie", "stylish"], "Slow-dread provocateur", "Hereditary, Midsommar, Eddington"),
  D("chu", "Jon M. Chu", 18, 1.1, ["romance", "comedy"], ["stylish", "heartfelt"], "Musical spectacle", "Wicked, Crazy Rich Asians, In the Heights"),
  D("lanthimos", "Yorgos Lanthimos", 18, 1.15, ["comedy", "drama"], ["stylish", "eerie"], "Deadpan absurdist", "Poor Things, The Favourite, Bugonia"),
  D("bigelow", "Kathryn Bigelow", 22, 1.15, ["thriller", "action"], ["gritty", "epic"], "Pressure-cooker realism", "The Hurt Locker, Zero Dark Thirty, A House of Dynamite"),
  D("chazelle", "Damien Chazelle", 20, 1.15, ["drama", "romance"], ["heartfelt", "stylish"], "Rhythm and obsession", "La La Land, Whiplash, Babylon"),
];

const L = (director, actor, bonus, films) => ({ director, actor, bonus, films });
const newLoyal = [
  L("coogler", "jordan", 0.12, "Fruitvale Station, Creed, Black Panther, Sinners"), L("coogler", "lupita", 0.1, "Black Panther, Black Panther: Wakanda Forever"),
  L("coogler", "duke", 0.1, "Black Panther, Black Panther: Wakanda Forever"), L("coogler", "thompson", 0.1, "Creed"),
  L("wright", "powell", 0.1, "The Running Man"), L("wright", "taylorjoy", 0.1, "Last Night in Soho"),
  L("waititi", "hemsworth", 0.12, "Thor: Ragnarok, Thor: Love and Thunder"), L("waititi", "thompson", 0.12, "Thor: Ragnarok, Thor: Love and Thunder"),
  L("waititi", "johansson", 0.1, "Jojo Rabbit"), L("waititi", "hiddleston", 0.1, "Thor: Ragnarok"),
  L("deltoro", "isaac", 0.1, "Frankenstein"), L("deltoro", "elordi", 0.1, "Frankenstein"), L("deltoro", "goth", 0.1, "Frankenstein"),
  L("deltoro", "hiddleston", 0.1, "Crimson Peak"), L("deltoro", "chastain", 0.1, "Crimson Peak"),
  L("rscott", "pascal", 0.1, "Gladiator II"), L("rscott", "mescal", 0.1, "Gladiator II"), L("rscott", "washington", 0.12, "American Gangster, Gladiator II"),
  L("rscott", "damon", 0.12, "The Martian, The Last Duel"), L("rscott", "comer", 0.1, "The Last Duel"), L("rscott", "chastain", 0.1, "The Martian"),
  L("spielberg", "cruise", 0.12, "Minority Report, War of the Worlds"),
  L("tarantino", "dicaprio", 0.12, "Django Unchained, Once Upon a Time in Hollywood"), L("tarantino", "pitt", 0.12, "Inglourious Basterds, Once Upon a Time in Hollywood"),
  L("tarantino", "robbie", 0.1, "Once Upon a Time in Hollywood"),
  L("bong", "pattinson", 0.1, "Mickey 17"), L("bong", "ackie", 0.1, "Mickey 17"), L("bong", "ruffalo", 0.1, "Mickey 17"), L("bong", "collette", 0.1, "Mickey 17"),
  L("bong", "yeun", 0.12, "Okja, Mickey 17"),
  L("flanagan", "ferguson", 0.1, "Doctor Sleep"), L("flanagan", "hiddleston", 0.1, "The Life of Chuck"),
  L("aster", "pugh", 0.1, "Midsommar"), L("aster", "collette", 0.1, "Hereditary"), L("aster", "phoenix", 0.12, "Beau Is Afraid, Eddington"),
  L("aster", "pascal", 0.1, "Eddington"), L("aster", "stone", 0.1, "Eddington"), L("aster", "butler", 0.1, "Eddington"),
  L("chu", "erivo", 0.12, "Wicked, Wicked: For Good"), L("chu", "grande", 0.12, "Wicked, Wicked: For Good"), L("chu", "yeoh", 0.12, "Crazy Rich Asians, Wicked"),
  L("chu", "wu", 0.1, "Crazy Rich Asians"), L("chu", "awkwafina", 0.1, "Crazy Rich Asians"),
  L("lanthimos", "stone", 0.15, "The Favourite, Poor Things, Kinds of Kindness, Bugonia"), L("lanthimos", "plemons", 0.12, "Kinds of Kindness, Bugonia"),
  L("lanthimos", "dafoe", 0.12, "Poor Things, Kinds of Kindness"), L("lanthimos", "ruffalo", 0.1, "Poor Things"),
  L("bigelow", "chastain", 0.1, "Zero Dark Thirty"), L("bigelow", "ferguson", 0.1, "A House of Dynamite"),
  L("chazelle", "gosling", 0.12, "La La Land, First Man"), L("chazelle", "stone", 0.1, "La La Land"), L("chazelle", "robbie", 0.1, "Babylon"),
  L("villeneuve", "butler", 0.1, "Dune: Part Two"), L("villeneuve", "ferguson", 0.12, "Dune, Dune: Part Two"),
  L("nolan", "damon", 0.12, "Interstellar, Oppenheimer"), L("nolan", "chastain", 0.1, "Interstellar"), L("nolan", "pugh", 0.1, "Oppenheimer"),
  L("peele", "yeun", 0.1, "Nope"), L("scorsese", "plemons", 0.1, "Killers of the Flower Moon"),
];

const C = (a, b, bonus, films) => ({ a, b, bonus, films });
const newChem = [
  C("erivo", "grande", 0.12, "Wicked, Wicked: For Good"), C("erivo", "davis", 0.08, "Widows"),
  C("hemsworth", "thompson", 0.1, "Thor: Ragnarok, Men in Black: International"), C("hemsworth", "hiddleston", 0.1, "Thor, Thor: Ragnarok"),
  C("jordan", "thompson", 0.12, "Creed, Creed II, Creed III"), C("jordan", "lupita", 0.08, "Black Panther"),
  C("mescal", "pascal", 0.08, "Gladiator II"), C("pitt", "dicaprio", 0.12, "Once Upon a Time in Hollywood"),
  C("robbie", "pitt", 0.1, "Once Upon a Time in Hollywood, Babylon"), C("robbie", "dicaprio", 0.12, "The Wolf of Wall Street, Once Upon a Time in Hollywood"),
  C("stone", "plemons", 0.1, "Kinds of Kindness, Bugonia"), C("stone", "dafoe", 0.08, "Poor Things, Kinds of Kindness"), C("stone", "ruffalo", 0.08, "Poor Things"),
  C("pattinson", "dafoe", 0.1, "The Lighthouse"), C("pattinson", "ackie", 0.08, "Mickey 17"),
  C("damon", "chastain", 0.1, "Interstellar, The Martian"), C("phoenix", "stone", 0.08, "Irrational Man, Eddington"),
  C("hiddleston", "chastain", 0.08, "Crimson Peak"), C("johansson", "hemsworth", 0.08, "The Avengers, Avengers: Endgame"),
  C("johansson", "ruffalo", 0.08, "The Avengers, Avengers: Endgame"), C("johansson", "olsen", 0.08, "Avengers: Age of Ultron, Avengers: Endgame"),
  C("rodriguez", "johnson", 0.08, "Fast & Furious 6, Furious 7, The Fate of the Furious"),
  C("yeoh", "awkwafina", 0.1, "Crazy Rich Asians"), C("wu", "awkwafina", 0.08, "Crazy Rich Asians"), C("yeoh", "wu", 0.08, "Crazy Rich Asians"),
  C("ferguson", "cruise", 0.12, "Mission: Impossible – Rogue Nation, Fallout, Dead Reckoning"),
  C("taylorjoy", "hemsworth", 0.08, "Furiosa"), C("comer", "butler", 0.08, "The Bikeriders"),
];

const pk = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
function addAll(name, add, key) {
  const cur = rd(name), have = new Set(cur.map(key)), fresh = add.filter((x) => !have.has(key(x)));
  wr(name, cur.concat(fresh));
  return fresh.length;
}
console.log("actors +" + addAll("actors", newActors, (x) => x.id));
console.log("directors +" + addAll("directors", newDirs, (x) => x.id));
console.log("loyal +" + addAll("loyal", newLoyal, (x) => x.director + "|" + x.actor));
console.log("chem +" + addAll("chem", newChem, (x) => pk(x.a, x.b)));
const a = rd("actors");
console.log("totals: actors", a.length, "(f", a.filter((x) => x.s === "f").length + ", m", a.filter((x) => x.s === "m").length + "), directors", rd("directors").length);
