export function buildRelayNode(password) {
  return [
    '  - name: "🇨🇦 加拿大@relay"',
    '    type: "ss"',
    '    server: "oldyyz03451.vgrapi.xyz"',
    "    port: 50330",
    '    cipher: "2022-blake3-aes-256-gcm"',
    "    password: " + JSON.stringify(password),
    "    udp: true",
    '    dialer-proxy: "🪜 链式前置"',
  ].join("\n");
}
