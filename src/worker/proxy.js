import { decodeBase64Text } from "./base64.js";

export function parseProxyUri(uri) {
  if (uri.startsWith("ss://")) {
    return parseSsUri(uri);
  }
  if (uri.startsWith("vless://")) {
    return parseVlessUri(uri);
  }
  throw new Error("unsupported proxy scheme");
}

function parseSsUri(uri) {
  const hashIndex = uri.indexOf("#");
  const name = readNodeName(uri, hashIndex);
  let payload = uri.slice(5, hashIndex >= 0 ? hashIndex : undefined);
  const queryIndex = payload.indexOf("?");
  if (queryIndex >= 0) {
    payload = payload.slice(0, queryIndex);
  }

  let credentials;
  let endpoint;
  const atIndex = payload.lastIndexOf("@");
  if (atIndex >= 0) {
    const token = decodeURIComponent(payload.slice(0, atIndex));
    credentials = token.includes(":") ? token : decodeBase64Text(token);
    endpoint = payload.slice(atIndex + 1);
  } else {
    const decoded = decodeBase64Text(payload);
    const decodedAt = decoded.lastIndexOf("@");
    if (decodedAt < 0) {
      throw new Error("invalid legacy ss uri");
    }
    credentials = decoded.slice(0, decodedAt);
    endpoint = decoded.slice(decodedAt + 1);
  }

  const separator = credentials.indexOf(":");
  if (separator < 1) {
    throw new Error("invalid ss credentials");
  }

  const serverUrl = new URL("http://" + endpoint);
  return {
    type: "ss",
    name,
    server: requireText(serverUrl.hostname, "ss server"),
    port: requirePort(serverUrl.port),
    cipher: requireText(credentials.slice(0, separator), "ss cipher"),
    password: credentials.slice(separator + 1),
  };
}

function parseVlessUri(uri) {
  const parsed = new URL(uri);
  const security = parsed.searchParams.get("security") || "";
  const reality = security === "reality";

  return {
    type: "vless",
    name: readNodeName(uri, uri.indexOf("#")),
    server: requireText(parsed.hostname, "vless server"),
    port: requirePort(parsed.port),
    uuid: requireText(decodeURIComponent(parsed.username), "vless uuid"),
    flow: parsed.searchParams.get("flow") || "",
    network: parsed.searchParams.get("type") || "tcp",
    tls: reality || security === "tls",
    servername: parsed.searchParams.get("sni") || "",
    fingerprint: parsed.searchParams.get("fp") || "",
    publicKey: parsed.searchParams.get("pbk") || "",
    shortId: parsed.searchParams.get("sid") || "",
    reality,
  };
}

export function serializeProxy(proxy) {
  if (proxy.type === "ss") {
    return [
      "  - name: " + JSON.stringify(proxy.name),
      "    type: ss",
      "    server: " + JSON.stringify(proxy.server),
      "    port: " + proxy.port,
      "    cipher: " + JSON.stringify(proxy.cipher),
      "    password: " + JSON.stringify(proxy.password),
      "    udp: true",
    ].join("\n");
  }

  const lines = [
    "  - name: " + JSON.stringify(proxy.name),
    "    type: vless",
    "    server: " + JSON.stringify(proxy.server),
    "    port: " + proxy.port,
    "    uuid: " + JSON.stringify(proxy.uuid),
    "    flow: " + JSON.stringify(proxy.flow),
    '    encryption: ""',
    "    network: " + JSON.stringify(proxy.network),
  ];

  if (proxy.tls) {
    lines.push("    tls: true");
  }
  if (proxy.servername) {
    lines.push("    servername: " + JSON.stringify(proxy.servername));
  }
  if (proxy.fingerprint) {
    lines.push("    client-fingerprint: " + JSON.stringify(proxy.fingerprint));
  }
  if (proxy.reality) {
    if (!proxy.publicKey || !proxy.shortId) {
      throw new Error("incomplete reality parameters");
    }
    lines.push("    reality-opts:");
    lines.push("      public-key: " + JSON.stringify(proxy.publicKey));
    lines.push("      short-id: " + JSON.stringify(proxy.shortId));
  }

  return lines.join("\n");
}

function readNodeName(uri, hashIndex) {
  if (hashIndex < 0) {
    throw new Error("proxy uri is missing a name");
  }
  return requireText(decodeURIComponent(uri.slice(hashIndex + 1)), "proxy name");
}

function requireText(value, label) {
  if (!value) {
    throw new Error("missing " + label);
  }
  return value;
}

function requirePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("invalid proxy port");
  }
  return port;
}
