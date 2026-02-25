// logic/roundRobin.js
const BYE_NAME = "BYE"; // or "Teacher / BYE"

function getNextThursday(startDate = new Date()) {
  const date = new Date(startDate);
  const day = date.getDay(); // 0 Sun .. 4 Thu
  const daysUntilThursday = (4 - day + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilThursday);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateCA(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Generate weekly "rounds" where every player plays each Thursday.
 * Uses the circle method.
 * Returns an array of rounds, where each round is an array of pairings.
 *
 * Each pairing:
 *  { player1, player2, level, player1_id?, player2_id?, isBye? }
 */
function generateWeeklyRounds(players) {
  // players can be objects with {id, name, level} or just {name, level}
  const level = players[0]?.level;

  // clone so we don't mutate caller data
  const list = players.map(p => ({
    id: p.id,
    name: p.name,
    level: p.level
  }));

  // If odd, add BYE
  if (list.length % 2 === 1) {
    list.push({ id: null, name: BYE_NAME, level });
  }

  const n = list.length;
  if (n < 2) return [];

  // Circle method:
  // Fix first player, rotate the rest
  const fixed = list[0];
  let rot = list.slice(1);

  const rounds = [];
  const roundCount = n - 1;

  for (let r = 0; r < roundCount; r++) {
    const roundPlayers = [fixed, ...rot];
    const pairings = [];

    for (let i = 0; i < n / 2; i++) {
      const a = roundPlayers[i];
      const b = roundPlayers[n - 1 - i];

      const isBye = a.name === BYE_NAME || b.name === BYE_NAME;

      pairings.push({
        level,
        player1: a.name,
        player2: b.name,
        player1_id: a.id ?? null,
        player2_id: b.id ?? null,
        isBye
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

    pairings.forEach(p => {
      scheduled.push({
        ...p,
        date: formatDateCA(d)
      });
    });
  });

  return scheduled;
}

module.exports = {
  getNextThursday,
  generateWeeklyRounds,
  scheduleWeeklyRounds
};