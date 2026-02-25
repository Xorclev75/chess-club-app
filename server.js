// server.js (Postgres version)
require("dotenv").config();

const dns = require("dns");
// Helps avoid IPv6 routing issues on some hosts (Render free tier)
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const path = require("path");

const { scheduleWeeklyRounds } = require("./logic/roundRobin");

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Env guard ----------
if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL env var.");
}

// ---------- Postgres pool (ONE pool only) ----------
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },

  // keep it tiny on free tiers
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,

  // keep connections alive
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

//DB Warm-Up Ping
(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("DB connected (startup ping ok)");
  } catch (e) {
    console.error("DB startup ping failed:", e.message);
  }
})();

//Retry wrapper
async function queryWithRetry(text, params, attempts = 2) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    const transient =
      err.code === "ETIMEDOUT" ||
      err.code === "ECONNRESET" ||
      (err.message && err.message.toLowerCase().includes("connection terminated")) ||
      (err.message && err.message.toLowerCase().includes("timeout"));

    if (!transient || attempts <= 1) throw err;

    // small backoff
    await new Promise(r => setTimeout(r, 400));
    return await queryWithRetry(text, params, attempts - 1);
  }
}

// ---------- Helpers ----------
function formatDateCA(d) {
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sendServerError(res, route, err) {
  console.error(`${route} failed:`, err);
  return res.status(500).json({ message: "Server error" });
}

async function getPlayersByLevel(client = pool) {
  const { rows } = await client.query(
    "SELECT id, name, level, score FROM players ORDER BY level ASC, name ASC"
  );

  const levels = {};
  for (const p of rows) {
    if (!levels[p.level]) levels[p.level] = [];
    levels[p.level].push(p);
  }
  return levels;
}

// ---------- Health ----------
app.get("/health", (req, res) => res.status(200).send("ok"));

// ---------- DB test ----------
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ success: true, timeFromDatabase: result.rows[0].now });
  } catch (err) {
    console.error("DB TEST FAILED:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- Players ----------
app.post("/add-player", async (req, res) => {
  try {
    const { name, level } = req.body;
    if (!name || !level) return res.status(400).json({ message: "Name and level are required" });

    await pool.query(
      "INSERT INTO players (name, level, score) VALUES ($1, $2, 0)",
      [name.trim(), Number(level)]
    );

    const { rows } = await pool.query(
      "SELECT id, name, level, score FROM players ORDER BY id ASC"
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, "POST /add-player", err);
  }
});

app.get("/players", async (req, res) => {
  try {
    const { rows } = await queryWithRetry(
      "SELECT id, name, level, score FROM players ORDER BY id ASC"
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, "GET /players", err);
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

    const { rows } = await pool.query(
      "SELECT id, name, level, score FROM players ORDER BY id ASC"
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, "PUT /players/:id", err);
  }
});

// IMPORTANT: prevent deleting a player used in saved matches
app.delete("/players/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM matches
       WHERE player1_id = $1 OR player2_id = $1`,
      [id]
    );

    if (rows[0].cnt > 0) {
      return res.status(409).json({
        message: "Cannot delete player: they are assigned to one or more saved matches. Remove them from schedules (or delete those schedules) first."
      });
    }

    await pool.query("DELETE FROM players WHERE id = $1", [id]);

    const { rows: players } = await pool.query(
      "SELECT id, name, level, score FROM players ORDER BY id ASC"
    );
    res.json(players);
  } catch (err) {
    sendServerError(res, "DELETE /players/:id", err);
  }
});

// ---------- Schedules ----------
app.get("/schedules", async (req, res) => {
  try {
    const { rows } = await queryWithRetry(
      "SELECT id, created_at FROM schedules ORDER BY id ASC"
    );
    res.json(rows.map(r => ({ id: r.id, createdAt: formatDateCA(r.created_at) })));
  } catch (err) {
    sendServerError(res, "GET /schedules", err);
  }
});

// ---------- Schedule (generate + save) ----------
app.post("/schedule", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const levels = await getPlayersByLevel(client);

    let matches = [];
    for (const levelPlayers of Object.values(levels)) {
      if (levelPlayers.length < 2) continue;

      const rr = [];
      for (let i = 0; i < levelPlayers.length; i++) {
        for (let j = i + 1; j < levelPlayers.length; j++) {
          rr.push({
            player1: levelPlayers[i].name,
            player2: levelPlayers[j].name,
            player1_id: levelPlayers[i].id,
            player2_id: levelPlayers[j].id,
            level: levelPlayers[i].level
          });
        }
      }

      const scheduled = scheduleMatches(rr).map((m) => ({
        ...m,
        status: "scheduled",
        result: null,
        notes: ""
      }));

      matches = matches.concat(scheduled);
    }

    const scheduleInsert = await client.query(
      "INSERT INTO schedules (created_at) VALUES (CURRENT_DATE) RETURNING id, created_at"
    );
    const scheduleId = scheduleInsert.rows[0].id;
    const createdAt = formatDateCA(scheduleInsert.rows[0].created_at);

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
          m.date,
          Number(m.level),
          Number(m.player1_id),
          Number(m.player2_id),
          m.status ?? "scheduled",
          m.result ?? null,
          m.notes ?? ""
        ]
      );
    }

    await client.query("COMMIT");

    const { rows: matchRows } = await pool.query(
      `
      SELECT
        m.match_key                               AS "matchId",
        to_char(m.match_date, 'YYYY-MM-DD')       AS "date",
        m.level                                   AS "level",
        p1.name                                   AS "player1",
        p2.name                                   AS "player2",
        m.player1_id                              AS "player1Id",
        m.player2_id                              AS "player2Id",
        m.status                                  AS "status",
        m.result                                  AS "result",
        m.notes                                   AS "notes"
      FROM matches m
      JOIN players p1 ON p1.id = m.player1_id
      JOIN players p2 ON p2.id = m.player2_id
      WHERE m.schedule_id = $1
      ORDER BY m.match_date ASC, m.level ASC, m.match_key ASC
      `,
      [scheduleId]
    );

    res.json({ id: scheduleId, createdAt, matches: matchRows });
  } catch (err) {
    await client.query("ROLLBACK");
    sendServerError(res, "POST /schedule", err);
  } finally {
    client.release();
  }
});

// ---------- Schedules CRUD ----------
app.get("/schedules", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, created_at FROM schedules ORDER BY id ASC");
    res.json(rows.map(r => ({ id: r.id, createdAt: formatDateCA(r.created_at) })));
  } catch (err) {
    sendServerError(res, "GET /schedules", err);
  }
});

app.get("/schedules/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const sched = await pool.query("SELECT id, created_at FROM schedules WHERE id = $1", [id]);
    if (sched.rows.length === 0) return res.status(404).json({ message: "Schedule not found" });

    const { rows: matchRows } = await pool.query(
      `
      SELECT
        m.match_key                               AS "matchId",
        to_char(m.match_date, 'YYYY-MM-DD')       AS "date",
        m.level                                   AS "level",
        p1.name                                   AS "player1",
        p2.name                                   AS "player2",
        m.player1_id                              AS "player1Id",
        m.player2_id                              AS "player2Id",
        m.status                                  AS "status",
        m.result                                  AS "result",
        m.notes                                   AS "notes"
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
      matches: matchRows
    });
  } catch (err) {
    sendServerError(res, "GET /schedules/:id", err);
  }
});

app.delete("/schedules/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM schedules WHERE id = $1", [id]);

    const { rows } = await pool.query("SELECT id, created_at FROM schedules ORDER BY id ASC");
    res.json(rows.map(r => ({ id: r.id, createdAt: formatDateCA(r.created_at) })));
  } catch (err) {
    sendServerError(res, "DELETE /schedules/:id", err);
  }
});

app.put("/schedules/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const updated = req.body;

    if (!updated?.matches || !Array.isArray(updated.matches)) {
      return res.status(400).json({ message: "Invalid schedule payload" });
    }

    await client.query("BEGIN");

    const sched = await client.query("SELECT id, created_at FROM schedules WHERE id = $1", [id]);
    if (sched.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Schedule not found" });
    }

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
          m.matchId
        ]
      );
    }

    await client.query("COMMIT");

    const { rows: matchRows } = await pool.query(
      `
      SELECT
        m.match_key                               AS "matchId",
        to_char(m.match_date, 'YYYY-MM-DD')       AS "date",
        m.level                                   AS "level",
        p1.name                                   AS "player1",
        p2.name                                   AS "player2",
        m.player1_id                              AS "player1Id",
        m.player2_id                              AS "player2Id",
        m.status                                  AS "status",
        m.result                                  AS "result",
        m.notes                                   AS "notes"
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
      matches: matchRows
    });
  } catch (err) {
    await client.query("ROLLBACK");
    sendServerError(res, "PUT /schedules/:id", err);
  } finally {
    client.release();
  }
});

// ---------- Start server ----------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Chess Club app running at http://0.0.0.0:${PORT}`);
});