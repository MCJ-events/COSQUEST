/* global __dirname */
// utils/vectorIcons.js stands in for the bare "@expo/vector-icons" (metro.config.js), so every icon
// family the app imports from it must be one the stand-in exports, or that icon would be undefined.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { it } = require("node:test");

const APP = path.resolve(__dirname, "..", "..");
const DIRS = ["app", "components", "features", "hooks", "utils", "constants", "services", "context", "store", "theme"];

function files(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "__tests__") files(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

it("every family imported from @expo/vector-icons is exported by utils/vectorIcons.js", () => {
  const shim = fs.readFileSync(path.join(APP, "utils", "vectorIcons.js"), "utf8");
  const exported = new Set([...shim.matchAll(/as (\w+) \} from/g)].map((m) => m[1]));
  const used = new Set();
  for (const dir of DIRS) {
    for (const f of files(path.join(APP, dir))) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/import\s*(type\s*)?\{([^}]*)\}\s*from\s*["']@expo\/vector-icons["']/g)) {
        if (m[1]) continue;
        for (const name of m[2].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean)) {
          if (/^[A-Za-z_]\w*$/.test(name)) used.add(name);
        }
      }
      assert.doesNotMatch(src, /import\s+\*\s+as\s+\w+\s+from\s+["']@expo\/vector-icons["']/, `${f}: namespace import of the icon index`);
    }
  }
  assert.ok(used.size > 0);
  for (const name of used) assert.ok(exported.has(name), `${name} is imported from @expo/vector-icons but utils/vectorIcons.js does not export it`);
});
