/**
 * Writes public/app-version.json from package.json for the static boot splash.
 * Run via npm run sync:app-version (also predev / prebuild).
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const payload = {
  name: "Brick-Motion",
  semver: String(pkg.version ?? "0.0.0")
};

const outPath = path.join(root, "public", "app-version.json");
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[sync:app-version] wrote ${outPath} → Version ${payload.semver}`);
