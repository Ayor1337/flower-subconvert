import { encodeBase64Text } from "./base64.js";

const SUPPORTED_TYPES = new Set(["ss", "vmess", "vless", "trojan"]);
const SUPPORTED_NETWORKS = new Set(["tcp", "ws"]);

export function buildShadowrocketSubscription(proxies) {
  const links = [];
  const converted = [];
  const skipped = [];

  for (const proxy of proxies) {
    try {
      links.push(serializeShadowrocketProxy(proxy));
      converted.push(proxy);
    } catch (error) {
      skipped.push({
        name: typeof proxy?.name === "string" ? proxy.name : "",
        type: typeof proxy?.type === "string" ? proxy.type : "",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    body: links.length ? encodeBase64Text(links.join("\n")) : "",
    converted,
    links,
    skipped,
  };
}

export function serializeShadowrocketProxy(proxy) {
  const type = requireText(proxy?.type, "proxy type").toLowerCase();
  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error("unsupported proxy type");
  }

  const network = readNetwork(proxy);
  if (!SUPPORTED_NETWORKS.has(network)) {
    throw new Error("unsupported transport: " + network);
  }
  if (isReality(proxy)) {
    throw new Error("reality is not supported");
  }

  switch (type) {
    case "ss":
      return serializeSs(proxy);
    case "vmess":
      return serializeVmess(proxy, network);
    case "vless":
      return serializeVless(proxy, network);
    case "trojan":
      return serializeTrojan(proxy, network);
    default:
      throw new Error("unsupported proxy type");
  }
}

function serializeSs(proxy) {
  const cipher = requireText(proxy.cipher, "ss cipher");
  const password = requireText(proxy.password, "ss password");
  const endpoint = formatEndpoint(proxy);
  const userInfo = cipher.startsWith("2022-")
    ? encodeURIComponent(cipher) + ":" + encodeURIComponent(password)
    : toBase64Url(cipher + ":" + password);
  const params = new URLSearchParams();
  const plugin = serializeSsPlugin(proxy);
  if (plugin) params.set("plugin", plugin);
  if (proxy.chain) params.set("chain", String(proxy.chain));
  const query = params.size ? "/?" + params.toString() : "";
  return "ss://" + userInfo + "@" + endpoint + query + "#" + encodeURIComponent(readName(proxy));
}

function serializeSsPlugin(proxy) {
  const plugin = textOrEmpty(proxy.plugin).toLowerCase();
  if (!plugin) {
    return "";
  }

  const options = proxy["plugin-opts"] || {};
  if (plugin === "obfs" || plugin === "simple-obfs" || plugin === "obfs-local") {
    const mode = requireText(options.mode || options.obfs, "ss obfs mode");
    const parts = ["simple-obfs", "obfs=" + mode];
    if (options.host || options["obfs-host"]) {
      parts.push("obfs-host=" + (options.host || options["obfs-host"]));
    }
    return parts.join(";");
  }

  if (plugin === "v2ray-plugin") {
    const mode = textOrEmpty(options.mode || "websocket").toLowerCase();
    if (mode !== "websocket") {
      throw new Error("unsupported ss plugin mode");
    }
    const parts = ["v2ray-plugin", "mode=websocket"];
    if (isTrue(options.tls)) parts.push("tls");
    if (options.host) parts.push("host=" + options.host);
    if (options.path) parts.push("path=" + options.path);
    return parts.join(";");
  }

  throw new Error("unsupported ss plugin");
}

function serializeVmess(proxy, network) {
  const ws = readWsOptions(proxy, network);
  const tls = hasTls(proxy);
  const payload = {
    v: "2",
    ps: readName(proxy),
    add: requireText(proxy.server, "vmess server"),
    port: String(requirePort(proxy.port)),
    id: requireText(proxy.uuid, "vmess uuid"),
    aid: String(proxy.alterId ?? proxy["alter-id"] ?? 0),
    scy: textOrEmpty(proxy.cipher || "auto"),
    net: network,
    type: "none",
    host: ws.host,
    path: ws.path,
    tls: tls ? "tls" : "",
    sni: tls ? textOrEmpty(proxy.servername || proxy.sni) : "",
  };
  if (isTrue(proxy["skip-cert-verify"])) payload.allowInsecure = 1;
  return "vmess://" + encodeBase64Text(JSON.stringify(payload));
}

function serializeVless(proxy, network) {
  const params = new URLSearchParams();
  params.set("encryption", textOrEmpty(proxy.encryption || "none"));
  if (proxy.flow) params.set("flow", String(proxy.flow));
  appendTransportAndTls(params, proxy, network);
  return buildStandardUri(
    "vless",
    requireText(proxy.uuid, "vless uuid"),
    proxy,
    params,
  );
}

function serializeTrojan(proxy, network) {
  const params = new URLSearchParams();
  appendTransportAndTls(params, proxy, network, true);
  return buildStandardUri(
    "trojan",
    requireText(proxy.password, "trojan password"),
    proxy,
    params,
  );
}

function buildStandardUri(scheme, credential, proxy, params) {
  return (
    scheme +
    "://" +
    encodeURIComponent(credential) +
    "@" +
    formatEndpoint(proxy) +
    "?" +
    params.toString() +
    "#" +
    encodeURIComponent(readName(proxy))
  );
}

function appendTransportAndTls(params, proxy, network, tlsRequired = false) {
  params.set("type", network);
  const tls = tlsRequired || hasTls(proxy);
  params.set("security", tls ? "tls" : "none");
  const servername = textOrEmpty(proxy.servername || proxy.sni);
  if (servername) params.set("sni", servername);
  if (network === "ws") {
    const ws = readWsOptions(proxy, network);
    if (ws.host) params.set("host", ws.host);
    if (ws.path) params.set("path", ws.path);
  }
  if (isTrue(proxy["skip-cert-verify"])) params.set("allowInsecure", "1");
}

function readWsOptions(proxy, network) {
  if (network !== "ws") return { host: "", path: "" };
  const options = proxy["ws-opts"] || {};
  const headers = options.headers || {};
  return {
    host: textOrEmpty(headers.Host || headers.host || proxy.host),
    path: textOrEmpty(options.path || proxy.path || "/"),
  };
}

function readNetwork(proxy) {
  return textOrEmpty(proxy.network || "tcp").toLowerCase();
}

function hasTls(proxy) {
  return isTrue(proxy.tls) || textOrEmpty(proxy.security).toLowerCase() === "tls";
}

function isReality(proxy) {
  return Boolean(proxy?.reality || proxy?.["reality-opts"]) || textOrEmpty(proxy?.security).toLowerCase() === "reality";
}

function formatEndpoint(proxy) {
  const server = requireText(proxy.server, "proxy server").replace(/^\[|\]$/g, "");
  const host = server.includes(":") ? "[" + server + "]" : server;
  return host + ":" + requirePort(proxy.port);
}

function readName(proxy) {
  return requireText(proxy.name, "proxy name");
}

function requireText(value, label) {
  if (typeof value !== "string" || !value) throw new Error("missing " + label);
  return value;
}

function textOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function requirePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("invalid proxy port");
  }
  return port;
}

function isTrue(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toBase64Url(value) {
  return encodeBase64Text(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
