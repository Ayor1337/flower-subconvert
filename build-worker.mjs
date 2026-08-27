import { readFile, writeFile } from "node:fs/promises";

const sourcePath = new URL("./clash-policy.yaml", import.meta.url);
const outputPath = new URL("./src/worker/config.generated.js", import.meta.url);

const merged = (await readFile(sourcePath, "utf8")).replace(/\r\n/g, "\n");
const tailStart = merged.indexOf("proxy-groups:\n");

if (tailStart < 0) {
  throw new Error("clash-policy.yaml 缺少 proxy-groups 段");
}

const fixedTail = merged.slice(tailStart).trimEnd();
const configSource = `// 此文件由 build-worker.mjs 生成，请勿手动编辑。\n\nexport const CONFIG_HEAD = ${JSON.stringify(`mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
ipv6: false

proxies:
`)};

export const FIXED_TAIL = ${JSON.stringify(fixedTail)};
`;

await writeFile(outputPath, configSource, "utf8");
console.log(`Generated src/worker/config.generated.js (${Buffer.byteLength(configSource)} bytes)`);
