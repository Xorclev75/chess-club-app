// logic/roundRobin.js
// Round-robin generator that supports odd player counts via BYE,
// and schedules rounds on consecutive Thursdays (one round per week).

function generateRoundRobin(players) {
  if (!Array.isArray(players) || players.length < 2) return [];

  // Shallow copy so we don't mutate caller array
  const list = [...players];

  // Add a BYE placeholder if odd number of players
  const isOdd = list.length % 2 === 1;
  if (isOdd) {
    list.push({ id: null, name: "BYE", level: list[0]?.level ?? null });
  }

  const n = list.length;
  const rounds = n - 1;
  const half = n / 2;

  // Circle method:
  // - Keep first player fixed
  // - Rotate the remaining players each round
  const fixed = list[0];
  let rotating = list.slice(1);

  const matches = [];

  for (let round = 1; round <= rounds; round++) {
    const roundPlayers = [fixed, ...rotating];

    for (let i = 0; i < half; i++) {
      const a = roundPlayers[i];
      const b = roundPlayers[n - 1 - i];

      if (!a || !b) continue;

      // BYE handling: represent as player2_id = null and player2 = "BYE"
      if (a.id == null || b.id == null) {
        const real = a.id == null ? b : a;

        // Defensive: skip if somehow both are BYE
        if (real.id == null) continue;

        matches.push({
          round,
          level: real.level,
          player1: real.name,
          player2: "BYE",
          player1_id: real.id,
          player2_id: null,
        });
      } else {
        matches.push({
          round,
          level: a.level,
          player1: a.name,
          player2: b.name,
          player1_id: a.id,
          player2_id: b.id,
        });
      }
    }

    // Rotate: move last element of rotating to the front
    rotating = [
      rotating[rotating.length - 1],
      ...rotating.slice(0, rotating.length - 1),
    ];
  }

  return matches;
}

function getNextThursday(startDate = new Date()) {
  const date = new Date(startDate);
  const day = date.getDay(); // 0=Sun ... 4=Thu
  const daysUntilThursday = (4 - day + 7) % 7 || 7; // next Thursday (not today)
  date.setDate(date.getDate() + daysUntilThursday);
  return date;
}

function scheduleMatches(matches, startDate = new Date()) {
  const firstThursday = getNextThursday(startDate);

  const hasRounds = matches.some((m) => Number.isFinite(m.round));

  // If round info exists, schedule one round per week (same date within a round)
  if (hasRounds) {
    return matches.map((match) => {
      const matchDate = new Date(firstThursday);
      matchDate.setDate(firstThursday.getDate() + (match.round - 1) * 7);

      return {
        ...match,
        date: matchDate.toLocaleDateString("en-CA"),
      };
    });
  }

  // Fallback: old behavior (one match per week)
  return matches.map((match, index) => {
    const matchDate = new Date(firstThursday);
    matchDate.setDate(firstThursday.getDate() + index * 7);

    return {
      ...match,
      date: matchDate.toLocaleDateString("en-CA"),
    };
  });
}

module.exports = {
  generateRoundRobin,
  scheduleMatches,
};