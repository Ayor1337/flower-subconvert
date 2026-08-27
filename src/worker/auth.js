import { decodeBase64Text } from "./base64.js";

export function readCredentialsFromToken(searchParams) {
  const token = searchParams.get("token") || "";
  if (!token) {
    return { error: "必须提供 token 字段" };
  }

  const normalizedToken = token.trim().replace(/ /g, "+");
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

  const service = fields[0].trim();
  const id = fields[1].trim();
  const password = fields[2];

  if (!service || !id || !password) {
    return { error: "token 中的 service、id 和 password 均不能为空" };
  }
  if (!/^\d{1,20}$/.test(service)) {
    return { error: "service 必须是 1 至 20 位数字" };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { error: "id 必须是有效的 UUID" };
  }
  if (password.length > 512 || /[\r\n]/.test(password)) {
    return { error: "password 格式无效" };
  }

  return { service, id, password };
}
