import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
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
await mkdir("build/site", { recursive: true });
await cp("web", "build/site", { recursive: true });
await writeFile("build/site/.nojekyll", "");
console.log("Demo assembled in build/site");
