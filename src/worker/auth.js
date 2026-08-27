import { decodeBase64Text } from "./base64.js";

const SHORT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{10}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readCredentialsFromToken(searchParams, env = {}) {
  const token = (searchParams.get("token") || "").trim();
  if (!token) {
    return { error: "必须提供 token 字段" };
  }

  if (SHORT_TOKEN_PATTERN.test(token)) {
    return readShortToken(token, env);
  }

  return readLegacyToken(token);
}

async function readShortToken(token, env) {
  if (!env.TOKENS || typeof env.TOKENS.get !== "function") {
    return { error: "TOKENS KV 未配置", status: 503 };
  }

  let storedValue;
  try {
    storedValue = await env.TOKENS.get(token);
  } catch {
    return { error: "短 token 存储暂时不可用", status: 503 };
  }

  if (storedValue === null) {
    return { error: "短 token 不存在或已失效" };
  }

  let record;
  try {
    record = JSON.parse(storedValue);
  } catch {
    return { error: "短 token 配置格式无效", status: 500 };
  }

  return validateCredentials(record);
}

function readLegacyToken(token) {
  const normalizedToken = token.replace(/ /g, "+");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(normalizedToken)) {
    return { error: "token 不是有效的 Base64" };
  }

  let decoded;
  try {
    decoded = decodeBase64Text(normalizedToken);
  } catch {
    return { error: "token 无法按 UTF-8 Base64 解码" };
  }

  const fields = decoded.split("|");
  if (fields.length !== 3) {
    return { error: "token 原文必须是 service|id|password" };
  }

  return validateCredentials({
    service: fields[0],
    id: fields[1],
    password: fields[2],
  });
}

function validateCredentials(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { error: "token 配置必须是 JSON 对象" };
  }

  const service = typeof record.service === "string" ? record.service.trim() : "";
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const password = typeof record.password === "string" ? record.password : "";

  if (!service || !id || !password) {
    return { error: "token 中的 service、id 和 password 均不能为空" };
  }
  if (!/^\d{1,20}$/.test(service)) {
    return { error: "service 必须是 1 至 20 位数字" };
  }
  if (!UUID_PATTERN.test(id)) {
    return { error: "id 必须是有效的 UUID" };
  }
  if (password.length > 512 || /[\r\n]/.test(password)) {
    return { error: "password 格式无效" };
  }

  return { service, id, password };
}

