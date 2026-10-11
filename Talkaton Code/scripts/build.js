const { readFileSync, writeFileSync } = require("fs");
const { join } = require("path");

const root = join(__dirname, "..");
const version = `t${Date.now()}`;

const serviceWorkers = [
  [join(root, "chat", "sw.js"), "talkaton"],
  [join(root, "talkatondesktop", "sw.js"), "talkaton-desktop"],
  [join(root, "codeaton", "sw.js"), "codeaton"]
];

for (const [swPath, prefix] of serviceWorkers) {
  const sw = readFileSync(swPath, "utf8").replace(
    /const CACHE_NAME = "[^"]+";/,
    `const CACHE_NAME = "${prefix}-${version}";`
  );
  writeFileSync(swPath, sw);
}

console.log(`Cache version: ${version}`);
