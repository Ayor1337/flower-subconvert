const NODE_NAME_RULES = [
  [/@c57s801(?:\.|:|["']|$)/i, "🇺🇸 美国@c57s801 [0.1x下载路线]", "c57s801"],
  [/@c57s1(?:\.|:|["']|$)/i, "🇺🇸 美国@c57s1", "c57s1"],
  [/@c57s2(?:\.|:|["']|$)/i, "🇺🇸 美国@c57s2", "c57s2"],
  [/@c57s3(?:\.|:|["']|$)/i, "🇺🇸 美国@c57s3", "c57s3"],
  [/@c57s4(?:\.|:|["']|$)/i, "🇯🇵 日本@c57s4", "c57s4"],
  [/@c57s5(?:\.|:|["']|$)/i, "🇳🇱 荷兰@c57s5", "c57s5"],
];

const REQUIRED_NODES = new Set(NODE_NAME_RULES.map(([, , code]) => code));

export function mapNodeName(rawName, found) {
  for (const [pattern, outputName, code] of NODE_NAME_RULES) {
    if (pattern.test(rawName)) {
      found.add(code);
      return outputName;
    }
  }
  return rawName;
}

export function validateRequiredNodes(found) {
  for (const code of REQUIRED_NODES) {
    if (!found.has(code)) {
      throw new Error("missing required node: " + code);
    }
  }
}
