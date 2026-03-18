// server.js (Postgres version) — BYE + whole-app password lock
require("dotenv").config();

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

const { generateRoundRobin, scheduleMatches } = require("./logic/roundRobin");

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---------- Env guard ----------
if (!process.env.DATABASE_URL) console.error("Missing DATABASE_URL env var.");
if (!process.env.ADMIN_PASSWORD) console.error("Missing ADMIN_PASSWORD env var.");
if (!process.env.AUTH_JWT_SECRET) console.error("Missing AUTH_JWT_SECRET env var.");

// ---------- Postgres pool ----------
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

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

// ---------- Auth ----------
const AUTH_COOKIE_NAME = "cc_auth";
const AUTH_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token) return res.status(401).json({ message: "Not authenticated" });

    jwt.verify(token, process.env.AUTH_JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Not authenticated" });
  }
}

app.get("/auth/me", (req, res) => {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token) return res.json({ authenticated: false });

    jwt.verify(token, process.env.AUTH_JWT_SECRET);
    return res.json({ authenticated: true });
  } catch {
    return res.json({ authenticated: false });
  }
});

app.post("/auth/login", (req, res) => {
  const { password } = req.body || {};

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Invalid password" });
  }

  const token = jwt.sign({ role: "admin" }, process.env.AUTH_JWT_SECRET, {
    expiresIn: "7d",
  });

  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: AUTH_MAX_AGE_MS,
  });

  return res.json({ ok: true });
});

app.post("/auth/logout", (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  });
  return res.json({ ok: true });
});

// ---------- Public ----------
app.get("/health", (req, res) => res.status(200).send("ok"));

// Serve static files publicly so index.html can load and show login screen
app.use(express.static(path.join(__dirname, "public")));

// ---------- Protected app routes ----------
app.use((req, res, next) => {
  if (
    req.path === "/health" ||
    req.path === "/auth/me" ||
    req.path === "/auth/login" ||
    req.path === "/auth/logout"
  ) {
    return next();
  }

  // Allow static assets through
  if (
    req.path.endsWith(".css") ||
    req.path.endsWith(".js") ||
    req.path.endsWith(".svg") ||
    req.path.endsWith(".ico") ||
    req.path.endsWith(".png") ||
    req.path.endsWith(".jpg") ||
    req.path.endsWith(".jpeg") ||
    req.path.endsWith(".webp")
  ) {
    return next();
  }

  return requireAuth(req, res, next);
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

    const { rows } = await pool.query("SELECT id, name, level, score FROM players ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    sendServerError(res, "POST /add-player", err);
  }
});

app.get("/players", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, level, score FROM players ORDER BY id ASC");
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

    await pool.query("UPDATE players SET name = $1, level = $2, score = $3 WHERE id = $4", [
      newName,
      newLevel,
      newScore,
      id,
    ]);

    const { rows } = await pool.query("SELECT id, name, level, score FROM players ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    sendServerError(res, "PUT /players/:id", err);
  }
});

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
        message:
          "Cannot delete player: they are assigned to one or more saved matches. Remove them from schedules (or delete those schedules) first.",
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

// ---------- Schedule preview ----------
app.get("/schedule", async (req, res) => {
  try {
    const levels = await getPlayersByLevel();

    let fullSchedule = [];
    for (const levelPlayers of Object.values(levels)) {
      if (levelPlayers.length < 2) continue;

      const matches = generateRoundRobin(levelPlayers);
      const scheduled = scheduleMatches(matches);
      fullSchedule = fullSchedule.concat(scheduled);
    }

    res.json(fullSchedule);
  } catch (err) {
    sendServerError(res, "GET /schedule", err);
  }
});

// ---------- Schedule generate + save ----------
app.post("/schedule", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const levels = await getPlayersByLevel(client);

    let matches = [];
    for (const levelPlayers of Object.values(levels)) {
      if (levelPlayers.length < 2) continue;

      const rr = generateRoundRobin(levelPlayers);
      const scheduled = scheduleMatches(rr).map((m) => ({
        ...m,
        status: "scheduled",
        result: null,
        notes: "",
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
          m.player2_id !== null && m.player2_id !== undefined ? Number(m.player2_id) : null,
          m.status ?? "scheduled",
          m.result ?? null,
          m.notes ?? "",
        ]
      );
    }

    await client.query("COMMIT");

    const { rows: matchRows } = await pool.query(
      `
      SELECT
        m.match_key                         AS "matchId",
        to_char(m.match_date, 'YYYY-MM-DD') AS "date",
        m.level                             AS "level",
        p1.name                             AS "player1",
        COALESCE(p2.name, 'BYE')            AS "player2",
        m.player1_id                        AS "player1Id",
        m.player2_id                        AS "player2Id",
        (m.player2_id IS NULL)              AS "isBye",
        m.status                            AS "status",
        m.result                            AS "result",
        m.notes                             AS "notes"
      FROM matches m
      JOIN players p1 ON p1.id = m.player1_id
      LEFT JOIN players p2 ON p2.id = m.player2_id
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
    res.json(rows.map((r) => ({ id: r.id, createdAt: formatDateCA(r.created_at) })));
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
        m.match_key                         AS "matchId",
        to_char(m.match_date, 'YYYY-MM-DD') AS "date",
        m.level                             AS "level",
        p1.name                             AS "player1",
        COALESCE(p2.name, 'BYE')            AS "player2",
        m.player1_id                        AS "player1Id",
        m.player2_id                        AS "player2Id",
        (m.player2_id IS NULL)              AS "isBye",
        m.status                            AS "status",
        m.result                            AS "result",
        m.notes                             AS "notes"
      FROM matches m
      JOIN players p1 ON p1.id = m.player1_id
      LEFT JOIN players p2 ON p2.id = m.player2_id
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
    sendServerError(res, "GET /schedules/:id", err);
  }
});

app.delete("/schedules/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM schedules WHERE id = $1", [id]);

    const { rows } = await pool.query("SELECT id, created_at FROM schedules ORDER BY id ASC");
    res.json(rows.map((r) => ({ id: r.id, createdAt: formatDateCA(r.created_at) })));
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

      const hasP1 = Object.prototype.hasOwnProperty.call(m, "player1Id");
      const hasP2 = Object.prototype.hasOwnProperty.call(m, "player2Id");

      await client.query(
        `
        UPDATE matches
        SET
          match_date = COALESCE($1, match_date),
          status     = COALESCE($2, status),
          result     = $3,
          notes      = COALESCE($4, notes),
          player1_id = CASE WHEN $9 THEN $5 ELSE player1_id END,
          player2_id = CASE WHEN $10 THEN $6 ELSE player2_id END
        WHERE schedule_id = $7 AND match_key = $8
        `,
        [
          m.date ?? null,
          m.status ?? null,
          m.result ?? null,
          m.notes ?? "",
          hasP1 ? m.player1Id : null,
          hasP2 ? m.player2Id : null,
          id,
          m.matchId,
          hasP1,
          hasP2,
        ]
      );
    }

    await client.query("COMMIT");

    const { rows: matchRows } = await pool.query(
      `
      SELECT
        m.match_key                         AS "matchId",
        to_char(m.match_date, 'YYYY-MM-DD') AS "date",
        m.level                             AS "level",
        p1.name                             AS "player1",
        COALESCE(p2.name, 'BYE')            AS "player2",
        m.player1_id                        AS "player1Id",
        m.player2_id                        AS "player2Id",
        (m.player2_id IS NULL)              AS "isBye",
        m.status                            AS "status",
        m.result                            AS "result",
        m.notes                             AS "notes"
      FROM matches m
      JOIN players p1 ON p1.id = m.player1_id
      LEFT JOIN players p2 ON p2.id = m.player2_id
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
    sendServerError(res, "PUT /schedules/:id", err);
  } finally {
    client.release();
  }
});

// ---------- Start server ----------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Chess Club app running at http://0.0.0.0:${PORT}`);
});