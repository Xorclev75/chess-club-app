// server.js (Render/Postgres/Supabase friendly) — IPv4-safe, ONE pool
"use strict";

require("dotenv").config();

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first"); // helps, but we ALSO hard-resolve IPv4 below

const net = require("net");
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const { scheduleWeeklyRounds } = require("./logic/roundRobin");

// -------------------- App --------------------
const app = express();
const PORT = process.env.PORT || 10000;

// -------------------- Middleware --------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// -------------------- Env guard --------------------
const hasPGVars =
  process.env.PGHOST &&
  process.env.PGPORT &&
  process.env.PGDATABASE &&
  process.env.PGUSER &&
  process.env.PGPASSWORD;

if (!process.env.DATABASE_URL && !hasPGVars) {
  console.error("❌ Missing DATABASE_URL or PG* env vars. Server cannot connect to Postgres.");
  process.exit(1);
}

// -------------------- Utilities / helpers --------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatDateCA(d) {
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sendServerError(res, route, err) {
  const code = err?.code || null;
  const message = err?.message || String(err);
  console.error(`${route} failed${code ? ` (${code})` : ""}:`, message);

  return res.status(500).json({
    message: "Server error",
    code,
    detail: message,
  });
}

// -------------------- IPv4 resolver --------------------
async function resolveIPv4(hostname) {
  if (net.isIP(hostname)) return hostname; // already an IP (v4 or v6)
  if (String(process.env.FORCE_IPV4 ?? "1") === "0") return hostname;

  try {
    const { address } = await dns.promises.lookup(hostname, { family: 4 });
    return address; // numeric IPv4, avoids AAAA selection entirely
  } catch (e) {
    console.warn(`⚠️ IPv4 lookup failed for ${hostname}; using hostname as-is.`, e.message);
    return hostname;
  }
}

// -------------------- Postgres Pool (ONE pool) --------------------
let pool; // initialized in initPool()

async function initPool() {
  if (hasPGVars) {
    const hostResolved = await resolveIPv4(process.env.PGHOST);

    pool = new Pool({
      host: hostResolved,
      port: Number(process.env.PGPORT),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: { rejectUnauthorized: false },

      max: Number(process.env.PG_POOL_MAX || 3),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 60000),

      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    console.log("DB config:", {
      using: "PG* vars",
      hostOriginal: process.env.PGHOST,
      hostResolved,
      port: Number(process.env.PGPORT),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
    });
  } else {
    // Preserve all params (?sslmode=, ?pgbouncer=, etc), just swap host
    const u = new URL(process.env.DATABASE_URL);
    const hostResolved = await resolveIPv4(u.hostname);
    u.hostname = hostResolved;

    pool = new Pool({
      connectionString: u.toString(),
      ssl: { rejectUnauthorized: false },

      max: Number(process.env.PG_POOL_MAX || 3),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 60000),

      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    console.log("DB config:", {
      using: "DATABASE_URL",
      hostOriginal: new URL(process.env.DATABASE_URL).hostname,
      hostResolved,
      note: "connectionString preserved",
    });
  }

  pool.on("error", (err) => console.error("🔥 PG pool error:", err.message));

  // warm-up
  await pool.query("SELECT 1");
  console.log("✅ DB connected (startup ping ok)");
}

// Retry wrapper for transient query issues
async function queryWithRetry(text, params = [], attempts = 3) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    const msg = String(err?.message || "").toLowerCase();
    const transient =
      err?.code === "ETIMEDOUT" ||
      err?.code === "ECONNRESET" ||
      err?.code === "ENETUNREACH" ||
      msg.includes("connection terminated") ||
      msg.includes("timeout") ||
      msg.includes("terminated unexpectedly");

    if (!transient || attempts <= 1) throw err;

    await sleep(500);
    return queryWithRetry(text, params, attempts - 1);
  }
}

async function connectWithRetry(attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const client = await pool.connect();
      client.on("error", (err) => console.error("PG client error:", err.message));
      return client;
    } catch (err) {
      const msg = String(err?.message || "").toLowerCase();
      const transient =
        err?.code === "ETIMEDOUT" ||
        err?.code === "ENETUNREACH" ||
        msg.includes("timeout") ||
        msg.includes("terminated") ||
        msg.includes("connection");

      if (!transient || i === attempts) throw err;
      await sleep(700 * i);
    }
  }
}

// ---- keep all your routes/data helpers below this line exactly as you already have ----

// -------------------- Start server (after DB init) --------------------
(async () => {
  try {
    await initPool();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Chess Club app running at http://0.0.0.0:${PORT}`);
    });
  } catch (e) {
    console.error("❌ Failed to init DB pool:", e.message);
    process.exit(1);
  }
})();