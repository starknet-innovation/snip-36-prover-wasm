import { createHash } from "node:crypto";
import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
await build({
  entryPoints: ["web/coinflip.mjs"],
  outfile: "web/coinflip-runtime.mjs",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await build({
  entryPoints: ["web/live.mjs"],
  outfile: "web/live-runtime.mjs",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await mkdir("web/demo-data", { recursive: true });
const fixture = JSON.parse(await readFile("fixtures/captured-execution.json"));
await writeFile(
  "web/demo-data/sample.json",
  JSON.stringify({
    request: fixture.request,
    source: { capture: fixture.capture },
    expected_pie_sha256: fixture.report.pie_sha256,
    block: fixture.anchor.header.block_number,
  }),
);
await cp("evidence/first-daily-ci-run.json", "web/demo-data/evidence.json");
await cp(
  "evidence/coinflip-deployment.json",
  "web/demo-data/coinflip-config.json",
);
for (const side of ["heads", "tails"]) {
  const round = JSON.parse(await readFile(`fixtures/coinflip/${side}.json`));
  await writeFile(
    `web/demo-data/coinflip-${side}.json`,
    JSON.stringify({
      request: round.request,
      source: { capture: round.capture },
      expected_pie_sha256: round.report.pie_sha256,
      coinflip: round.coinflip,
    }),
  );
}
await mkdir("build/site", { recursive: true });
await cp("web", "build/site", { recursive: true });
const liveVersion = createHash("sha256")
  .update(await readFile("web/live-runtime.mjs"))
  .digest("hex")
  .slice(0, 16);
const livePage = await readFile("build/site/play.html", "utf8");
await writeFile(
  "build/site/play.html",
  livePage.replace("./live-runtime.mjs", `./live-runtime.mjs?v=${liveVersion}`),
);
await writeFile("build/site/.nojekyll", "");
console.log("Demo assembled in build/site");
