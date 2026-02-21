// Keep variables at the top!
const express = require("express");
const fs = require("fs");
const path = require("path");

const { generateRoundRobin, scheduleMatches } = require("./logic/roundRobin");

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Paths
const DATA_FILE = path.join(__dirname, "players.json");
const SCHEDULE_FILE = path.join(__dirname, "schedules.json");

// Ensure JSON files exist
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
if (!fs.existsSync(SCHEDULE_FILE)) fs.writeFileSync(SCHEDULE_FILE, "[]");

// ---------- Helpers ----------
function readJSON(file) {
  try {
    const data = fs.readFileSync(file, "utf8");
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// ---------- Players ----------
app.post("/add-player", (req, res) => {
  const { name, level } = req.body;

  if (!name || !level) {
    return res.status(400).json({ message: "Name and level are required" });
  }

  const players = readJSON(DATA_FILE);

  const newPlayer = {
    id: Date.now(),
    name,
    level: Number(level),
    score: 0
  };

  players.push(newPlayer);
  writeJSON(DATA_FILE, players);

  res.json(players);
});

app.get("/players", (req, res) => {
  res.json(readJSON(DATA_FILE));
});

app.put("/players/:id", (req, res) => {
  const { id } = req.params;
  const { name, level, score } = req.body;

  const players = readJSON(DATA_FILE);
  const index = players.findIndex(p => p.id == id);

  if (index === -1) return res.status(404).json({ message: "Player not found" });

  players[index] = {
    ...players[index],
    name: name ?? players[index].name,
    level: level !== undefined ? Number(level) : players[index].level,
    score: score !== undefined ? Number(score) : (players[index].score ?? 0)
  };

  writeJSON(DATA_FILE, players);
  res.json(players);
});

app.delete("/players/:id", (req, res) => {
  let players = readJSON(DATA_FILE);
  players = players.filter(p => p.id != req.params.id);

  writeJSON(DATA_FILE, players);
  res.json(players);
});

// ---------- Schedule (preview only; does not save) ----------
app.get("/schedule", (req, res) => {
  const players = readJSON(DATA_FILE);

  const levels = {};
  players.forEach(p => {
    if (!levels[p.level]) levels[p.level] = [];
    levels[p.level].push(p);
  });

  let fullSchedule = [];

  Object.values(levels).forEach(levelPlayers => {
    if (levelPlayers.length < 2) return;

    const matches = generateRoundRobin(levelPlayers);
    const scheduled = scheduleMatches(matches);
    fullSchedule = fullSchedule.concat(scheduled);
  });

  res.json(fullSchedule);
});

// ---------- Schedule (generate + save) ----------
app.post("/schedule", (req, res) => {
  const players = readJSON(DATA_FILE);
  const schedules = readJSON(SCHEDULE_FILE);

  const levels = {};
  players.forEach(p => {
    if (!levels[p.level]) levels[p.level] = [];
    levels[p.level].push(p);
  });

  let matches = [];

  Object.values(levels).forEach(levelPlayers => {
    if (levelPlayers.length < 2) return;

    const rr = generateRoundRobin(levelPlayers);
    const scheduled = scheduleMatches(rr);
    matches = matches.concat(scheduled);
  });

  const scheduleId = Date.now();

  matches = matches.map((m, idx) => ({
    ...m,
    matchId: `${scheduleId}-${idx}`,
    status: m.status ?? "scheduled",
    result: m.result ?? null,
    notes: m.notes ?? ""
  }));

  const newSchedule = {
    id: scheduleId,
    createdAt: new Date().toLocaleDateString("en-CA"),
    matches
  };

  schedules.push(newSchedule);
  writeJSON(SCHEDULE_FILE, schedules);

  res.json(newSchedule);
});

// ---------- Schedules CRUD ----------
app.get("/schedules", (req, res) => {
  res.json(readJSON(SCHEDULE_FILE));
});

app.get("/schedules/:id", (req, res) => {
  const schedules = readJSON(SCHEDULE_FILE);
  const schedule = schedules.find(s => s.id == req.params.id);

  if (!schedule) return res.status(404).json({ message: "Schedule not found" });
  res.json(schedule);
});

app.delete("/schedules/:id", (req, res) => {
  let schedules = readJSON(SCHEDULE_FILE);
  schedules = schedules.filter(s => s.id != req.params.id);

  writeJSON(SCHEDULE_FILE, schedules);
  res.json(schedules);
});

// ✅ Save/overwrite an entire schedule (for "Save Schedule" button)
app.put("/schedules/:id", (req, res) => {
  const { id } = req.params;
  const updated = req.body;

  const schedules = readJSON(SCHEDULE_FILE);
  const idx = schedules.findIndex(s => s.id == id);
  if (idx === -1) return res.status(404).json({ message: "Schedule not found" });

  schedules[idx] = {
    ...schedules[idx],
    ...updated,
    id: schedules[idx].id
  };

  writeJSON(SCHEDULE_FILE, schedules);
  res.json(schedules[idx]);
});

// Update one match inside a schedule (still useful if you ever go back to autosave)
app.put("/schedules/:scheduleId/matches/:matchId", (req, res) => {
  const { scheduleId, matchId } = req.params;
  const { date, player1, player2, status, result, notes } = req.body;

  const schedules = readJSON(SCHEDULE_FILE);
  const sIndex = schedules.findIndex(s => s.id == scheduleId);
  if (sIndex === -1) return res.status(404).json({ message: "Schedule not found" });

  const schedule = schedules[sIndex];
  const mIndex = schedule.matches.findIndex(m => m.matchId === matchId);
  if (mIndex === -1) return res.status(404).json({ message: "Match not found" });

  const existing = schedule.matches[mIndex];

  schedule.matches[mIndex] = {
    ...existing,
    date: date ?? existing.date,
    player1: player1 ?? existing.player1,
    player2: player2 ?? existing.player2,
    status: status ?? existing.status,
    result: result ?? existing.result,
    notes: notes ?? existing.notes
  };

  schedules[sIndex] = schedule;
  writeJSON(SCHEDULE_FILE, schedules);

  res.json(schedule);
});

// Start server (keep at bottom)
app.listen(PORT, () => {
  console.log(`Chess Club app running at http://localhost:${PORT}`);
});