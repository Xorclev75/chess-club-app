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

function getFirstAndThirdTuesdays(startDate = new Date(), count = 20) {
  const dates = [];
  let current = new Date(startDate);

  while (dates.length < count) {
    const year = current.getFullYear();
    const month = current.getMonth();

    // Find first day of month
    const firstDay = new Date(year, month, 1);

    // Find first Tuesday
    const firstTuesdayOffset = (2 - firstDay.getDay() + 7) % 7;
    const firstTuesday = new Date(year, month, 1 + firstTuesdayOffset);

    // Third Tuesday = first Tuesday + 14 days
    const thirdTuesday = new Date(firstTuesday);
    thirdTuesday.setDate(firstTuesday.getDate() + 14);

    // Only include future dates
    if (firstTuesday >= startDate) dates.push(new Date(firstTuesday));
    if (thirdTuesday >= startDate) dates.push(new Date(thirdTuesday));

    // Move to next month
    current.setMonth(current.getMonth() + 1);
    current.setDate(1);
  }

  return dates.sort((a, b) => a - b);
}

function scheduleMatches(matches, startDate = new Date()) {
  const hasRounds = matches.some((m) => Number.isFinite(m.round));

  const scheduleDates = getFirstAndThirdTuesdays(startDate, 50);

  if (hasRounds) {
    return matches.map((match) => {
      const matchDate = scheduleDates[match.round - 1];

      return {
        ...match,
        date: matchDate.toLocaleDateString("en-CA"),
      };
    });
  }

  // fallback
  return matches.map((match, index) => {
    const matchDate = scheduleDates[index];

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