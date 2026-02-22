// server.js (Postgres version)
require("dotenv").config();
const express = require("express");

const app = express();

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("Chess Club app running");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Chess Club app running at http://localhost:${PORT}`);
});

try {
  const u = new URL(process.env.DATABASE_URL);
  console.log("DB host =", u.hostname);
  console.log("DB port =", u.port);
  console.log("DB user =", u.username);
} catch (e) {
  console.log("DATABASE_URL is not a valid URL:", e.message);
}

const express = require("express");
const path = require("path");
const { Pool } = require("pg");



const { generateRoundRobin, scheduleMatches } = require("./logic/roundRobin");

//CORS
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors()); // allow all origins for now
app.use(express.json());

// Health check
app.get("/health", (req, res) => res.status(200).send("ok"));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));



// Postgres pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Helpers ---
function formatDateCA(d) {
  // Returns YYYY-MM-DD in local time
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function getPlayersByLevel() {
  const { rows } = await pool.query(
    "SELECT id, name, level, score FROM players ORDER BY level ASC, name ASC"
  );

  const levels = {};
  for (const p of rows) {
    if (!levels[p.level]) levels[p.level] = [];
    levels[p.level].push(p);
  }
  return levels;
}

// ---------- Players ----------
app.post("/add-player", async (req, res) => {
  try {
    const { name, level } = req.body;
    if (!name || !level) {
      return res.status(400).json({ message: "Name and level are required" });
    }

    await pool.query(
      "INSERT INTO players (name, level, score) VALUES ($1, $2, 0)",
      [name.trim(), Number(level)]
    );

    const { rows } = await pool.query("SELECT id, name, level, score FROM players ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    console.error("POST /add-player failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/players", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, level, score FROM players ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    console.error("GET /players failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/players/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, level, score } = req.body;

    const { rows: existingRows } = await pool.query(
      "SELECT id, name, level, score FROM players WHERE id = $1",
      [id]
    );
    if (existingRows.length === 0) return res.status(404).json({ message: "Player not found" });

    const existing = existingRows[0];

    const newName = name ?? existing.name;
    const newLevel = level !== undefined ? Number(level) : existing.level;
    const newScore = score !== undefined ? Number(score) : Number(existing.score ?? 0);

    await pool.query(
      "UPDATE players SET name = $1, level = $2, score = $3 WHERE id = $4",
      [newName, newLevel, newScore, id]
    );

    const { rows } = await pool.query("SELECT id, name, level, score FROM players ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    console.error("PUT /players/:id failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/players/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM players WHERE id = $1", [id]);

    const { rows } = await pool.query("SELECT id, name, level, score FROM players ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    console.error("DELETE /players/:id failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- Schedule (preview only; does not save) ----------
app.get("/schedule", async (req, res) => {
  try {
    const levels = await getPlayersByLevel();

    let fullSchedule = [];

    for (const levelPlayers of Object.values(levels)) {
      if (levelPlayers.length < 2) continue;

      // IMPORTANT: your roundRobin.js currently expects objects with .name and .level
      // These players have id/name/level/score, so it works.
      const matches = generateRoundRobin(levelPlayers);

      // scheduleMatches returns { player1, player2, level, date }
      const scheduled = scheduleMatches(matches);

      fullSchedule = fullSchedule.concat(scheduled);
    }

    res.json(fullSchedule);
  } catch (err) {
    console.error("GET /schedule failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- Schedule (generate + save) ----------
app.post("/schedule", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const levels = await getPlayersByLevel();

    let matches = [];

    for (const levelPlayers of Object.values(levels)) {
      if (levelPlayers.length < 2) continue;

      // Build pairings from player objects (has id + name)
      const rr = [];
      for (let i = 0; i < levelPlayers.length; i++) {
        for (let j = i + 1; j < levelPlayers.length; j++) {
          rr.push({
            // keep names for UI
            player1: levelPlayers[i].name,
            player2: levelPlayers[j].name,
            // keep ids for DB
            player1_id: levelPlayers[i].id,
            player2_id: levelPlayers[j].id,
            level: levelPlayers[i].level,
          });
        }
      }

      // Now schedule by Thursdays
      const scheduled = scheduleMatches(rr).map((m) => ({
        ...m,
        // scheduleMatches gives date, player1, player2, level
        // ensure ids are carried through (they are in rr, so spread keeps them)
        status: "scheduled",
        result: null,
        notes: "",
      }));

      matches = matches.concat(scheduled);
    }

    // Create schedule
    const scheduleInsert = await client.query(
      "INSERT INTO schedules (created_at) VALUES (CURRENT_DATE) RETURNING id, created_at"
    );
    const scheduleId = scheduleInsert.rows[0].id;
    const createdAt = formatDateCA(scheduleInsert.rows[0].created_at);

    // Insert matches
    for (let idx = 0; idx < matches.length; idx++) {
      const m = matches[idx];

      const matchKey = `${scheduleId}-${idx}`;
      await client.query(
        `INSERT INTO matches
          (schedule_id, match_key, match_date, level, player1_id, player2_id, status, result, notes)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          scheduleId,
          matchKey,
          m.date, // YYYY-MM-DD
          Number(m.level),
          Number(m.player1_id),
          Number(m.player2_id),
          m.status ?? "scheduled",
          m.result ?? null,
          m.notes ?? "",
        ]
      );
    }

    await client.query("COMMIT");

    // Return the saved schedule in the format your UI expects
    // Join to get names (in case player names change later, this always reflects current)
    const { rows: matchRows } = await pool.query(
      `
      SELECT
        m.match_key       AS "matchId",
        m.match_date      AS "date",
        m.level           AS "level",
        p1.name           AS "player1",
        p2.name           AS "player2",
        m.player1_id      AS "player1Id",
        m.player2_id      AS "player2Id",
        m.status          AS "status",
        m.result          AS "result",
        m.notes           AS "notes"
      FROM matches m
      JOIN players p1 ON p1.id = m.player1_id
      JOIN players p2 ON p2.id = m.player2_id
      WHERE m.schedule_id = $1
      ORDER BY m.match_date ASC, m.level ASC, m.match_key ASC
      `,
      [scheduleId]
    );

    res.json({
      id: scheduleId,
      createdAt,
      matches: matchRows,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /schedule failed:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

// ---------- Schedules CRUD ----------
app.get("/schedules", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at FROM schedules ORDER BY id ASC`
    );

    res.json(rows.map(r => ({
      id: r.id,
      createdAt: formatDateCA(r.created_at),
    })));
  } catch (err) {
    console.error("GET /schedules failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/schedules/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const sched = await pool.query(
      "SELECT id, created_at FROM schedules WHERE id = $1",
      [id]
    );
    if (sched.rows.length === 0) return res.status(404).json({ message: "Schedule not found" });

    const { rows: matchRows } = await pool.query(
      `
      SELECT
        m.match_key       AS "matchId",
        m.match_date      AS "date",
        m.level           AS "level",
        p1.name           AS "player1",
        p2.name           AS "player2",
        m.player1_id      AS "player1Id",
        m.player2_id      AS "player2Id",
        m.status          AS "status",
        m.result          AS "result",
        m.notes           AS "notes"
      FROM matches m
      JOIN players p1 ON p1.id = m.player1_id
      JOIN players p2 ON p2.id = m.player2_id
      WHERE m.schedule_id = $1
      ORDER BY m.match_date ASC, m.level ASC, m.match_key ASC
      `,
      [id]
    );

    res.json({
      id: Number(sched.rows[0].id),
      createdAt: formatDateCA(sched.rows[0].created_at),
      matches: matchRows,
    });
  } catch (err) {
    console.error("GET /schedules/:id failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/schedules/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // matches delete automatically via ON DELETE CASCADE
    await pool.query("DELETE FROM schedules WHERE id = $1", [id]);

    const { rows } = await pool.query("SELECT id, created_at FROM schedules ORDER BY id ASC");
    res.json(rows.map(r => ({ id: r.id, createdAt: formatDateCA(r.created_at) })));
  } catch (err) {
    console.error("DELETE /schedules/:id failed:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Save/overwrite entire schedule (for "Save Schedule" button)
app.put("/schedules/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const updated = req.body;

    // updated = { id, createdAt, matches: [...] }
    if (!updated?.matches || !Array.isArray(updated.matches)) {
      return res.status(400).json({ message: "Invalid schedule payload" });
    }

    await client.query("BEGIN");

    // ensure schedule exists
    const sched = await client.query("SELECT id, created_at FROM schedules WHERE id = $1", [id]);
    if (sched.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Schedule not found" });
    }

    // Update matches by match_key (matchId)
    for (const m of updated.matches) {
      if (!m.matchId) continue;

      await client.query(
        `
        UPDATE matches
        SET
          match_date = COALESCE($1, match_date),
          status     = COALESCE($2, status),
          result     = $3,
          notes      = COALESCE($4, notes),
          player1_id = COALESCE($5, player1_id),
          player2_id = COALESCE($6, player2_id)
        WHERE schedule_id = $7 AND match_key = $8
        `,
        [
          m.date ?? null,
          m.status ?? null,
          m.result ?? null,
          m.notes ?? "",
          m.player1Id ?? null,
          m.player2Id ?? null,
          id,
          m.matchId,
        ]
      );
    }

    await client.query("COMMIT");

    // Return fresh schedule (joined names)
    const { rows: matchRows } = await pool.query(
      `
      SELECT
        m.match_key       AS "matchId",
        m.match_date      AS "date",
        m.level           AS "level",
        p1.name           AS "player1",
        p2.name           AS "player2",
        m.player1_id      AS "player1Id",
        m.player2_id      AS "player2Id",
        m.status          AS "status",
        m.result          AS "result",
        m.notes           AS "notes"
      FROM matches m
      JOIN players p1 ON p1.id = m.player1_id
      JOIN players p2 ON p2.id = m.player2_id
      WHERE m.schedule_id = $1
      ORDER BY m.match_date ASC, m.level ASC, m.match_key ASC
      `,
      [id]
    );

    res.json({
      id: Number(id),
      createdAt: formatDateCA(sched.rows[0].created_at),
      matches: matchRows,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /schedules/:id failed:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

// Test
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      success: true,
      timeFromDatabase: result.rows[0].now
    });
  } catch (err) {
    console.error("DB TEST FAILED:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Chess Club app running at http://localhost:${PORT}`);
});