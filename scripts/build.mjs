import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: {
    js: "import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);",
  },
  sourcemap: false,
  minify: false,
  legalComments: "eof",
});
await build({
  entryPoints: ["src/pricing.ts"],
  outfile: "dist/pricing.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
});
writeFileSync("dist/package.json", JSON.stringify({ type: "module" }));
console.log(
  "Built dist/index.mjs (handler index.handler) and pricing contract module.",
);
