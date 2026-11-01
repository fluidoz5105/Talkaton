const { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync } = require("fs");
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

// Publish only public assets; server code, tests, secrets and Git history stay private.
const output = join(root, ".build-cache", "public");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const excluded = new Set(["api", "server", "scripts", "tests", "desktop", "node_modules", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vercel.json", "AGENTS.md", "DEPLOYMENT.md"]);
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.name.startsWith(".") || excluded.has(entry.name) || entry.isSymbolicLink()) continue;
  cpSync(join(root, entry.name), join(output, entry.name), { recursive: true,
    filter: source => !source.split(/[\\/]/).some(part => ["node_modules", "mac-arm64", "win-unpacked"].includes(part) || part.endsWith(".app"))
  });
}
console.log("Public assets prepared in .build-cache/public");
