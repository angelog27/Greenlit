// Per-player rate limits for the callables, kept in each function instance's memory (no database reads).
// With maxInstances 50 a player gets at most fifty times these across instances, which still bounds what a
// runaway or hostile client can cost. Legitimate play stays far below them.
const RULES = {
  default: { max: 40, windowMs: 60_000 }, // any campaign call
  release: { max: 30, windowMs: 60_000 }, // daily/basic releases
  hard: { max: 6, windowMs: 60_000 }, // switching a project to real dates re-checks every date (a few seconds of CPU)
  style: { max: 10, windowMs: 60_000 }, // studio look (reads Storage)
  restart: { max: 3, windowMs: 60_000 }, // starting over builds a new project
};

function makeLimiter(rules = RULES, clock = Date.now) {
  const hits = new Map();
  // true if the call may go ahead (and is counted), false if the player is over the limit for that kind.
  return function allow(uid, kind) {
    const r = rules[kind] || rules.default, now = clock(), key = uid + "|" + kind;
    const recent = (hits.get(key) || []).filter((t) => now - t < r.windowMs);
    if (recent.length >= r.max) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 20_000) hits.clear(); // keep memory bounded on a long-lived instance
    return true;
  };
}

// The first bytes of a real JPEG, PNG or WebP file (uploads are only labelled by the browser).
function isImageBytes(b) {
  if (!b || b.length < 12) return false;
  const at = (i, bytes) => bytes.every((x, k) => b[i + k] === x);
  return at(0, [0xff, 0xd8, 0xff]) || at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]));
}

module.exports = { RULES, makeLimiter, isImageBytes };
