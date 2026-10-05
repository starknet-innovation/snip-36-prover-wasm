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
await writeFile("build/site/.nojekyll", "");
console.log("Demo assembled in build/site");
