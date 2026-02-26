// logic/roundRobin.js — copy/paste, safer + deterministic
"use strict";

const BYE_NAME = "BYE"; // or "Teacher / BYE"

// Always operate on local "date-only" values to avoid timezone surprises.
function toDateOnly(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatDateCA(d) {
  const x = toDateOnly(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Get the next Thursday AFTER the given date.
 * - If today is Thursday, it returns next week's Thursday (not today).
 */
function getNextThursday(startDate = new Date()) {
  const date = toDateOnly(startDate);
  const day = date.getDay(); // 0 Sun .. 4 Thu
  const daysUntilThursday = (4 - day + 7) % 7 || 7; // ensures "next", not "same day"
  date.setDate(date.getDate() + daysUntilThursday);
  return date;
}

// Stable sort helper to keep schedules consistent between runs
function stableSortPlayers(players) {
  return [...players].sort((a, b) => {
    const la = Number(a.level ?? 0);
    const lb = Number(b.level ?? 0);
    if (la !== lb) return la - lb;

    const na = String(a.name ?? "");
    const nb = String(b.name ?? "");
    const nc = na.localeCompare(nb);
    if (nc !== 0) return nc;

    // Final tie-breaker: id
    const ia = a.id === null || a.id === undefined ? Number.POSITIVE_INFINITY : Number(a.id);
    const ib = b.id === null || b.id === undefined ? Number.POSITIVE_INFINITY : Number(b.id);
    return ia - ib;
  });
}

/**
 * Generate weekly "rounds" using the circle method.
 * Returns an array of rounds; each round is an array of pairings.
 *
 * Each pairing:
 *  { player1, player2, level, player1_id, player2_id, isBye }
 */
function generateWeeklyRounds(players) {
  if (!Array.isArray(players) || players.length === 0) return [];

  // All players should be same level for this call; take from first as default
  const level = Number(players[0]?.level ?? 0);

  // Clone + normalize
  const list = stableSortPlayers(players).map((p) => ({
    id: p.id === undefined ? null : p.id,
    name: String(p.name ?? "").trim(),
    level: Number(p.level ?? level),
  }));

  // Remove blanks (optional safety)
  const cleaned = list.filter((p) => p.name.length > 0);

  // If odd, add BYE
  if (cleaned.length % 2 === 1) {
    cleaned.push({ id: null, name: BYE_NAME, level });
  }

  const n = cleaned.length;
  if (n < 2) return [];

  // Circle method:
  // Fix first player, rotate the rest
  const fixed = cleaned[0];
  let rot = cleaned.slice(1);

  const rounds = [];
  const roundCount = n - 1;

  for (let r = 0; r < roundCount; r++) {
    const roundPlayers = [fixed, ...rot];
    const pairings = [];

    for (let i = 0; i < n / 2; i++) {
      const a = roundPlayers[i];
      const b = roundPlayers[n - 1 - i];

      const isBye = a.name === BYE_NAME || b.name === BYE_NAME;

      // Optional: alternate colors/home-away feel by swapping sides each round
      // (keeps pairings but avoids one player always appearing as "player1")
      const swap = r % 2 === 1 && !isBye;

      const p1 = swap ? b : a;
      const p2 = swap ? a : b;

      pairings.push({
        level,
        player1: p1.name,
        player2: p2.name,
        player1_id: p1.id ?? null,
        player2_id: p2.id ?? null,
        isBye,
      });
    }

    rounds.push(pairings);

    // rotate: take last of rot and move to front
    rot = [rot[rot.length - 1], ...rot.slice(0, rot.length - 1)];
  }

  return rounds;
}

/**
 * Schedule rounds onto consecutive Thursdays.
 * Returns a flat list of matches with dates.
 */
function scheduleWeeklyRounds(players, startDate = new Date()) {
  const firstThursday = getNextThursday(startDate);
  const rounds = generateWeeklyRounds(players);

  const scheduled = [];
  rounds.forEach((pairings, weekIndex) => {
    const d = new Date(firstThursday);
    d.setDate(firstThursday.getDate() + weekIndex * 7);

    const dateStr = formatDateCA(d);
    pairings.forEach((p) => {
      scheduled.push({
        ...p,
        date: dateStr,
      });
    });
  });

  return scheduled;
}

module.exports = {
  BYE_NAME,
  getNextThursday,
  generateWeeklyRounds,
  scheduleWeeklyRounds,
};