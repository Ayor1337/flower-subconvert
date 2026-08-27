import { decodeBase64Text } from "./base64.js";

export function parseProxyUri(uri) {
  if (uri.startsWith("ss://")) {
    return parseSsUri(uri);
  }
  if (uri.startsWith("vless://")) {
    return parseVlessUri(uri);
  }
  if (uri.startsWith("vmess://")) {
    return parseVmessUri(uri);
  }
  if (uri.startsWith("trojan://")) {
    return parseTrojanUri(uri);
  }
  throw new Error("unsupported proxy scheme");
}

function parseSsUri(uri) {
  const hashIndex = uri.indexOf("#");
  const name = readNodeName(uri, hashIndex);
  let payload = uri.slice(5, hashIndex >= 0 ? hashIndex : undefined);
  const queryIndex = payload.indexOf("?");
  const pluginValue = queryIndex >= 0
    ? new URLSearchParams(payload.slice(queryIndex + 1)).get("plugin")
    : "";
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
  const proxy = {
    type: "ss",
    name,
    server: requireText(serverUrl.hostname, "ss server"),
    port: requirePort(serverUrl.port),
    cipher: requireText(credentials.slice(0, separator), "ss cipher"),
    password: credentials.slice(separator + 1),
  };
  if (pluginValue) Object.assign(proxy, parseSsPlugin(pluginValue));
  return proxy;
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
    encryption: parsed.searchParams.get("encryption") || "none",
    network: parsed.searchParams.get("type") || "tcp",
    tls: reality || security === "tls",
    servername: parsed.searchParams.get("sni") || "",
    fingerprint: parsed.searchParams.get("fp") || "",
    publicKey: parsed.searchParams.get("pbk") || "",
    shortId: parsed.searchParams.get("sid") || "",
    "skip-cert-verify": parsed.searchParams.get("allowInsecure") === "1",
    "ws-opts": readWsOptions(parsed),
    reality,
  };
}

function parseVmessUri(uri) {
  let config;
  try {
    config = JSON.parse(decodeBase64Text(uri.slice(8)));
  } catch {
    throw new Error("invalid vmess uri");
  }
  const network = config.net || "tcp";
  return {
    type: "vmess",
    name: requireText(config.ps, "vmess name"),
    server: requireText(config.add, "vmess server"),
    port: requirePort(config.port),
    uuid: requireText(config.id, "vmess uuid"),
    alterId: Number(config.aid || 0),
    cipher: config.scy || "auto",
    network,
    tls: config.tls === "tls",
    servername: config.sni || "",
    "skip-cert-verify": config.allowInsecure === 1 || config.allowInsecure === true,
    "ws-opts": network === "ws"
      ? { path: config.path || "/", headers: config.host ? { Host: config.host } : {} }
      : {},
  };
}

function parseTrojanUri(uri) {
  const parsed = new URL(uri);
  const network = parsed.searchParams.get("type") || "tcp";
  return {
    type: "trojan",
    name: readNodeName(uri, uri.indexOf("#")),
    server: requireText(parsed.hostname, "trojan server"),
    port: requirePort(parsed.port || "443"),
    password: requireText(decodeURIComponent(parsed.username), "trojan password"),
    network,
    tls: true,
    servername: parsed.searchParams.get("sni") || "",
    "skip-cert-verify": parsed.searchParams.get("allowInsecure") === "1",
    "ws-opts": readWsOptions(parsed),
  };
}

function readWsOptions(parsed) {
  if ((parsed.searchParams.get("type") || "tcp") !== "ws") return {};
  const host = parsed.searchParams.get("host") || "";
  return {
    path: parsed.searchParams.get("path") || "/",
    headers: host ? { Host: host } : {},
  };
}

function parseSsPlugin(value) {
  const [rawName, ...rawOptions] = value.split(";");
  const options = {};
  for (const rawOption of rawOptions) {
    const separator = rawOption.indexOf("=");
    if (separator < 0) options[rawOption] = true;
    else options[rawOption.slice(0, separator)] = rawOption.slice(separator + 1);
  }
  if (["simple-obfs", "obfs-local", "obfs"].includes(rawName)) {
    return {
      plugin: "obfs",
      "plugin-opts": {
        mode: options.obfs || options.mode || "",
        host: options["obfs-host"] || options.host || "",
      },
    };
  }
  if (rawName === "v2ray-plugin") {
    return {
      plugin: rawName,
      "plugin-opts": {
        mode: options.mode || "websocket",
        tls: Boolean(options.tls),
        host: options.host || "",
        path: options.path || "",
      },
    };
  }
  return { plugin: rawName, "plugin-opts": options };
}

export function serializeProxy(proxy) {
  if (proxy.type === "ss") {
    const lines = [
      "  - name: " + JSON.stringify(proxy.name),
      "    type: ss",
      "    server: " + JSON.stringify(proxy.server),
      "    port: " + proxy.port,
      "    cipher: " + JSON.stringify(proxy.cipher),
      "    password: " + JSON.stringify(proxy.password),
      "    udp: true",
    ];
    appendPlugin(lines, proxy);
    return lines.join("\n");
  }

  const type = proxy.type;
  const lines = [
    "  - name: " + JSON.stringify(proxy.name),
    "    type: " + type,
    "    server: " + JSON.stringify(proxy.server),
    "    port: " + proxy.port,
  ];

  if (type === "trojan") lines.push("    password: " + JSON.stringify(proxy.password));
  else {
    lines.push("    uuid: " + JSON.stringify(proxy.uuid));
    if (type === "vmess") {
      lines.push("    alterId: " + (proxy.alterId || 0));
      lines.push("    cipher: " + JSON.stringify(proxy.cipher || "auto"));
    } else {
      lines.push("    flow: " + JSON.stringify(proxy.flow || ""));
      lines.push("    encryption: " + JSON.stringify(proxy.encryption || "none"));
    }
  }
  lines.push("    network: " + JSON.stringify(proxy.network || "tcp"));

  if (proxy.tls) {
    lines.push("    tls: true");
  }
  if (proxy.servername) {
    lines.push("    servername: " + JSON.stringify(proxy.servername));
  }
  if (proxy.fingerprint) {
    lines.push("    client-fingerprint: " + JSON.stringify(proxy.fingerprint));
  }
  if (proxy["skip-cert-verify"]) lines.push("    skip-cert-verify: true");
  appendWsOptions(lines, proxy);
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

function appendWsOptions(lines, proxy) {
  if (proxy.network !== "ws") return;
  const options = proxy["ws-opts"] || {};
  lines.push("    ws-opts:");
  lines.push("      path: " + JSON.stringify(options.path || "/"));
  const host = options.headers?.Host || options.headers?.host;
  if (host) {
    lines.push("      headers:");
    lines.push("        Host: " + JSON.stringify(host));
  }
}

function appendPlugin(lines, proxy) {
  if (!proxy.plugin) return;
  lines.push("    plugin: " + JSON.stringify(proxy.plugin));
  const options = proxy["plugin-opts"] || {};
  if (!Object.keys(options).length) return;
  lines.push("    plugin-opts:");
  for (const [key, value] of Object.entries(options)) {
    lines.push("      " + key + ": " + JSON.stringify(value));
  }
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
