// server.js (Render/Postgres/Supabase pooler friendly)
"use strict";

require("dotenv").config();

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first"); // helps IPv6 routing issues on some hosts (Render free tier)

const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const { scheduleWeeklyRounds } = require("./logic/roundRobin");

// -------------------- App --------------------
const app = express();
const PORT = process.env.PORT || 10000;
const isProd = process.env.NODE_ENV === "production";

// -------------------- Middleware --------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// -------------------- Env guard (fail fast) --------------------
if (!process.env.DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL env var. Server cannot connect to Postgres.");
  // Failing fast is better than timing out on every request
  process.exit(1);
}

// -------------------- Postgres Pool (ONE pool) --------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // On Render / managed Postgres, SSL is commonly required.
  // For local dev, this avoids needing local SSL setup.
  ssl: isProd ? { rejectUnauthorized: false } : false,

  // Keep tiny on free tiers
  max: Number(process.env.PG_POOL_MAX || 2),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 10000),

  // Keep alive
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Optional: surface pool errors (helps debugging)
pool.on("error", (err) => {
  console.error("🔥 Unexpected PG pool error:", err.message);
});

// Warm-up ping (helps cold starts)
(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("✅ DB connected (startup ping ok)");
  } catch (e) {
    console.error("❌ DB startup ping failed:", e.message);
  }
})();

// -------------------- Small utilities --------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatDateCA(d) {
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sendServerError(res, route, err) {
  const code = err?.code ? ` (${err.code})` : "";
  console.error(`${route} failed${code}:`, err?.message || err);
  return res.status(500).json({ message: "Server error" });
}

// Retry wrapper for transient pool/network issues
async function queryWithRetry(text, params = [], attempts = 2) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    const msg = String(err?.message || "").toLowerCase();
    const transient =
      err?.code === "ETIMEDOUT" ||
      err?.code === "ECONNRESET" ||
      msg.includes("connection terminated") ||
      msg.includes("timeout") ||
      msg.includes("terminated unexpectedly");

    if (!transient || attempts <= 1) throw err;

    await sleep(400);
    return queryWithRetry(text, params, attempts - 1);
  }
}

// -------------------- Data helpers --------------------
async function listPlayers() {
  const { rows } = await queryWithRetry(
    "SELECT id, name, level, score FROM players ORDER BY id ASC"
  );
  return rows;
}

async function listSchedules() {
  const { rows } = await queryWithRetry(
    "SELECT id, created_at FROM schedules ORDER BY id ASC"
  );
  return rows.map((r) => ({ id: r.id, createdAt: formatDateCA(r.created_at) }));
}

async function getPlayersByLevel(client) {
  const db = client || pool;
  const { rows } = await db.query(
    "SELECT id, name, level, score FROM players ORDER BY level ASC, name ASC"
  );

  const levels = {};
  for (const p of rows) {
    (levels[p.level] ||= []).push(p);
  }
  return levels;
}

async function fetchScheduleMatches(scheduleId) {
  // LEFT JOIN so BYE/null player IDs still render
  const { rows } = await queryWithRetry(
    `
    SELECT
      m.match_key                               AS "matchId",
      to_char(m.match_date, 'YYYY-MM-DD')       AS "date",
      m.level                                   AS "level",
      COALESCE(p1.name, 'BYE')                  AS "player1",
      COALESCE(p2.name, 'BYE')                  AS "player2",
      m.player1_id                              AS "player1Id",
      m.player2_id                              AS "player2Id",
      m.status                                  AS "status",
      m.result                                  AS "result",
      m.notes                                   AS "notes"
    FROM matches m
    LEFT JOIN players p1 ON p1.id = m.player1_id
    LEFT JOIN players p2 ON p2.id = m.player2_id
    WHERE m.schedule_id = $1
    ORDER BY m.match_date ASC, m.level ASC, m.match_key ASC
    `,
    [scheduleId]
  );
  return rows;
}

// -------------------- Health / DB test --------------------
app.get("/health", (req, res) => res.status(200).send("ok"));

app.get("/db-test", async (req, res) => {
  try {
    const result = await queryWithRetry("SELECT NOW()");
    res.json({ success: true, timeFromDatabase: result.rows[0].now });
  } catch (err) {
    console.error("DB TEST FAILED:", err?.message || err);
    res.status(500).json({ success: false, error: err?.message || "DB error" });
  }
});

// -------------------- Players --------------------
app.get("/players", async (req, res) => {
  try {
    res.json(await listPlayers());
  } catch (err) {
    sendServerError(res, "GET /players", err);
  }
});

app.post("/add-player", async (req, res) => {
  try {
    const { name, level } = req.body;
    if (!name || level === undefined || level === null) {
      return res.status(400).json({ message: "Name and level are required" });
    }

    await queryWithRetry(
      "INSERT INTO players (name, level, score) VALUES ($1, $2, 0)",
      [String(name).trim(), Number(level)]
    );

    res.json(await listPlayers());
  } catch (err) {
    sendServerError(res, "POST /add-player", err);
  }
});

app.put("/players/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, level, score } = req.body;

    const { rows: existingRows } = await queryWithRetry(
      "SELECT id, name, level, score FROM players WHERE id = $1",
      [id]
    );
    if (existingRows.length === 0) return res.status(404).json({ message: "Player not found" });

    const existing = existingRows[0];

    const newName = name ?? existing.name;
    const newLevel = level !== undefined ? Number(level) : existing.level;
    const newScore = score !== undefined ? Number(score) : Number(existing.score ?? 0);

    await queryWithRetry(
      "UPDATE players SET name = $1, level = $2, score = $3 WHERE id = $4",
      [newName, newLevel, newScore, id]
    );

    res.json(await listPlayers());
  } catch (err) {
    sendServerError(res, "PUT /players/:id", err);
  }
});

// Prevent deleting a player used in saved matches
app.delete("/players/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await queryWithRetry(
      `
      SELECT COUNT(*)::int AS cnt
      FROM matches
      WHERE player1_id = $1 OR player2_id = $1
      `,
      [id]
    );

    if (rows[0].cnt > 0) {
      return res.status(409).json({
        message:
          "Cannot delete player: they are assigned to one or more saved matches. Remove them from schedules (or delete those schedules) first.",
      });
    }

    await queryWithRetry("DELETE FROM players WHERE id = $1", [id]);
    res.json(await listPlayers());
  } catch (err) {
    sendServerError(res, "DELETE /players/:id", err);
  }
});

// -------------------- Schedules list --------------------
app.get("/schedules", async (req, res) => {
  try {
    res.json(await listSchedules());
  } catch (err) {
    sendServerError(res, "GET /schedules", err);
  }
});

// -------------------- Get one schedule --------------------
app.get("/schedules/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const sched = await queryWithRetry("SELECT id, created_at FROM schedules WHERE id = $1", [id]);
    if (sched.rows.length === 0) return res.status(404).json({ message: "Schedule not found" });

    const matches = await fetchScheduleMatches(id);

    res.json({
      id: Number(sched.rows[0].id),
      createdAt: formatDateCA(sched.rows[0].created_at),
      matches,
    });
  } catch (err) {
    sendServerError(res, "GET /schedules/:id", err);
  }
});

// -------------------- Delete schedule --------------------
app.delete("/schedules/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // assumes matches has ON DELETE CASCADE on schedule_id FK
    await queryWithRetry("DELETE FROM schedules WHERE id = $1", [id]);

    res.json(await listSchedules());
  } catch (err) {
    sendServerError(res, "DELETE /schedules/:id", err);
  }
});

// -------------------- Generate + save schedule --------------------
app.post("/schedule", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const levels = await getPlayersByLevel(client);

    const scheduleInsert = await client.query(
      "INSERT INTO schedules (created_at) VALUES (CURRENT_DATE) RETURNING id, created_at"
    );
    const scheduleId = scheduleInsert.rows[0].id;
    const createdAt = formatDateCA(scheduleInsert.rows[0].created_at);

    let idx = 0;

    for (const levelPlayers of Object.values(levels)) {
      if (levelPlayers.length < 2) continue;

      const scheduled = scheduleWeeklyRounds(levelPlayers);

      for (const m of scheduled) {
        const matchKey = `${scheduleId}-${idx++}`;

        await client.query(
          `
          INSERT INTO matches
            (schedule_id, match_key, match_date, level, player1_id, player2_id, status, result, notes)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [
            scheduleId,
            matchKey,
            m.date,
            Number(m.level),
            m.player1_id ?? null,
            m.player2_id ?? null,
            "scheduled",
            null,
            m.isBye ? "BYE" : "",
          ]
        );
      }
    }

    await client.query("COMMIT");

    const matches = await fetchScheduleMatches(scheduleId);
    res.json({ id: scheduleId, createdAt, matches });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    sendServerError(res, "POST /schedule", err);
  } finally {
    client.release();
  }
});

// -------------------- Save/overwrite entire schedule --------------------
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
          player1_id = $5,
          player2_id = $6
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

    const matches = await fetchScheduleMatches(id);

    res.json({
      id: Number(id),
      createdAt: formatDateCA(sched.rows[0].created_at),
      matches,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    sendServerError(res, "PUT /schedules/:id", err);
  } finally {
    client.release();
  }
});

// -------------------- Start server --------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Chess Club app running at http://0.0.0.0:${PORT}`);
});