import { mapNodeName, validateRequiredNodes } from "./node-names.js";
import { parseProxyUri, serializeProxy } from "./proxy.js";
import { decodeBase64Text } from "./base64.js";

export function extractAndRenameProxies(payload) {
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
  return renamed;
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
  const blocks = uris.map((uri) => {
    const proxy = parseProxyUri(uri);
    proxy.name = mapNodeName(proxy.name, found);
    return serializeProxy(proxy);
  });

  validateRequiredNodes(found);
  return blocks.join("\n");
}
