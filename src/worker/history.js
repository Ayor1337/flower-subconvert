import { decodeBase64Text, encodeBase64Text } from "./base64.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const RETENTION_MS = 72 * 60 * 60 * 1000;

export async function hashToken(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function readClientIp(headers) {
  const ip = (headers.get("cf-connecting-ip") || "").trim();
  if (!ip || ip.length > 45 || /[\s,]/.test(ip)) {
    return null;
  }
  return ip;
}

export async function recordSubscriptionAttempt(db, event) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("HISTORY_DB D1 未配置");
  }

  const tokenHash = await hashToken(event.token);
  await db.prepare(
    `INSERT INTO subscription_ip_events
      (token_hash, ip, requested_at, method, status_code)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(
    tokenHash,
    event.ip,
    event.requestedAt,
    event.method,
    event.statusCode,
  ).run();
}

export async function readSubscriptionHistory(db, token, searchParams, now = Date.now()) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("HISTORY_DB D1 未配置");
  }

  const limit = parseLimit(searchParams.get("limit"));
  const cursor = parseCursor(searchParams.get("cursor"));
  const tokenHash = await hashToken(token);
  const cutoff = now - RETENTION_MS;
  const fetchLimit = limit + 1;

  let statement;
  if (cursor) {
    statement = db.prepare(
      `SELECT id, ip, requested_at, method, status_code
       FROM subscription_ip_events
       WHERE token_hash = ?1
         AND requested_at >= ?2
         AND (requested_at < ?3 OR (requested_at = ?3 AND id < ?4))
       ORDER BY requested_at DESC, id DESC
       LIMIT ?5`,
    ).bind(tokenHash, cutoff, cursor.requestedAt, cursor.id, fetchLimit);
  } else {
    statement = db.prepare(
      `SELECT id, ip, requested_at, method, status_code
       FROM subscription_ip_events
       WHERE token_hash = ?1 AND requested_at >= ?2
       ORDER BY requested_at DESC, id DESC
       LIMIT ?3`,
    ).bind(tokenHash, cutoff, fetchLimit);
  }

  const result = await statement.all();
  const rows = Array.isArray(result.results) ? result.results : [];
  const pageRows = rows.slice(0, limit);
  const nextCursor = rows.length > limit && pageRows.length
    ? encodeCursor(pageRows[pageRows.length - 1])
    : null;

  return {
    items: pageRows.map((row) => ({
      ip: row.ip,
      requestedAt: new Date(row.requested_at).toISOString(),
      method: row.method,
      statusCode: row.status_code,
      success: row.status_code === 200,
    })),
    nextCursor,
  };
}

export async function pruneSubscriptionHistory(db, now = Date.now()) {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("HISTORY_DB D1 未配置");
  }

  return db.prepare(
    "DELETE FROM subscription_ip_events WHERE requested_at < ?1",
  ).bind(now - RETENTION_MS).run();
}

function parseLimit(value) {
  if (value === null || value === "") {
    return DEFAULT_LIMIT;
  }
  if (!/^\d+$/.test(value)) {
    throw new HistoryQueryError("limit 必须是整数");
  }

  const limit = Number(value);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new HistoryQueryError(`limit 必须在 1 至 ${MAX_LIMIT} 之间`);
  }
  return limit;
}

function parseCursor(value) {
  if (!value) {
    return null;
  }

  try {
    const decoded = JSON.parse(decodeBase64Text(value));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      !Number.isSafeInteger(decoded[0]) ||
      !Number.isSafeInteger(decoded[1]) ||
      decoded[0] < 0 ||
      decoded[1] < 1
    ) {
      throw new Error("invalid cursor payload");
    }
    return { requestedAt: decoded[0], id: decoded[1] };
  } catch {
    throw new HistoryQueryError("cursor 无效");
  }
}

function encodeCursor(row) {
  return encodeBase64Text(JSON.stringify([row.requested_at, row.id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export class HistoryQueryError extends Error {}
