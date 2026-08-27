import { mapNodeName, validateRequiredNodes } from "./node-names.js";
import { parseProxyUri, serializeProxy } from "./proxy.js";
import { decodeBase64Text } from "./base64.js";

export function extractAndRenameProxies(payload) {
  return extractAndRenameSubscription(payload).proxyEntries;
}

export function extractAndRenameSubscription(payload) {
  const normalized = payload.replace(/\r\n/g, "\n");
  if (/^proxies:\s*$/m.test(normalized)) {
    return extractYamlProxies(normalized);
  }
  return convertEncodedSubscription(normalized);
}

function extractYamlProxies(yaml) {
  const lines = yaml.split("\n");
  const proxyLines = [];
  let inProxies = false;

  for (const line of lines) {
    if (!inProxies) {
      if (line.trim() === "proxies:" && !/^\s/.test(line)) {
        inProxies = true;
      }
      continue;
    }

    if (/^[^\s][^:]*:/.test(line)) {
      break;
    }
    proxyLines.push(line);
  }

  const proxyBlock = proxyLines.join("\n").replace(/^\n+/, "").trimEnd();
  if (!proxyBlock) {
    throw new Error("missing proxies");
  }

  const found = new Set();
  const renamed = proxyBlock.replace(/^(\s*-\s+name:\s*)(.+)$/gm, (line, prefix, rawName) => {
    const mapped = mapNodeName(rawName, found);
    return mapped === rawName ? line : prefix + JSON.stringify(mapped);
  });

  validateRequiredNodes(found);
  return {
    proxyEntries: renamed,
    proxies: parseYamlProxyBlock(renamed),
  };
}

function convertEncodedSubscription(payload) {
  const compact = payload.trim().replace(/\s+/g, "");
  if (
    !compact ||
    compact.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)
  ) {
    throw new Error("unsupported subscription payload");
  }

  const decoded = decodeBase64Text(compact);
  const uris = decoded.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!uris.length) {
    throw new Error("empty encoded subscription");
  }

  const found = new Set();
  const proxies = uris.map((uri) => {
    const proxy = parseProxyUri(uri);
    proxy.name = mapNodeName(proxy.name, found);
    return proxy;
  });
  const blocks = proxies.map(serializeProxy);

  validateRequiredNodes(found);
  return {
    proxyEntries: blocks.join("\n"),
    proxies,
  };
}

function parseYamlProxyBlock(proxyBlock) {
  const proxies = [];
  let current = null;
  let stack = [];

  for (const line of proxyBlock.split("\n")) {
    const item = line.match(/^(\s*)-\s+name:\s*(.+)$/);
    if (item) {
      current = { name: parseYamlValue(item[2]) };
      proxies.push(current);
      stack = [{ indent: item[1].length + 1, value: current }];
      continue;
    }
    if (!current || !line.trim() || /^\s*#/.test(line)) continue;

    const field = line.match(/^(\s*)([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!field) continue;
    const indent = field[1].length;
    const key = field[2];
    const rawValue = field[3] ?? "";

    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    if (!rawValue) {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
    } else {
      parent[key] = parseYamlValue(rawValue);
    }
  }

  return proxies;
}

function parseYamlValue(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value);
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("{") && value.endsWith("}")) return parseInlineMap(value.slice(1, -1));
  return value;
}

function parseInlineMap(source) {
  const result = {};
  for (const entry of splitInlineEntries(source)) {
    const separator = entry.indexOf(":");
    if (separator < 1) continue;
    const key = entry.slice(0, separator).trim().replace(/^['"]|['"]$/g, "");
    result[key] = parseYamlValue(entry.slice(separator + 1));
  }
  return result;
}

function splitInlineEntries(source) {
  const entries = [];
  let start = 0;
  let quote = "";
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "," && depth === 0) {
      entries.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(source.slice(start).trim());
  return entries.filter(Boolean);
}
