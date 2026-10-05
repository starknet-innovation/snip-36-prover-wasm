import test from "node:test";
import assert from "node:assert/strict";
import { PublicRunController } from "../web/public-run-controller.mjs";
function setup(save = async () => {}) {
  const workers = [],
    statuses = [],
    completed = [];
  let next = 0;
  const control = new PublicRunController({
    save,
    onStatus: (v) => statuses.push(v),
    onComplete: (v) => completed.push(v),
    idFactory: () => String(++next),
    workerFactory: (url) => {
      const w = {
        url,
        terminated: false,
        terminate() {
          this.terminated = true;
        },
        postMessage(data) {
          this.sent = data;
        },
      };
      workers.push(w);
      return w;
    },
  });
  return { control, workers, statuses, completed };
}
const execution = (id) => ({
  id,
  kind: "execution",
  ok: true,
  pie: new Uint8Array([1, 2, 3]).buffer,
  report: {},
  capture: { sha256: "test" },
  execution: {},
  request: {},
  anchor: {},
  output: [],
});
test("execution PIE passes to separate prover only after persistence", async () => {
  const saved = [],
    s = setup(async (r) => saved.push(r)),
    id = s.control.start({}, {});
  await s.workers[0].onmessage({ data: execution(id) });
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].pie, [1, 2, 3]);
  assert.equal(s.workers.length, 2);
  assert(s.workers[0].terminated);
  assert.deepEqual([...new Uint8Array(s.workers[1].sent.pie)], [1, 2, 3]);
  await s.workers[1].onmessage({
    data: { id, kind: "proof", ok: true, proof: [9], report: {} },
  });
  assert.equal(saved.length, 2);
  assert.equal(s.completed.length, 1);
  assert.equal(s.control.active, null);
});
test("cancel during persistence suppresses proving and stale completion", async () => {
  let release;
  const s = setup(() => new Promise((r) => (release = r))),
    id = s.control.start({}, {});
  const pending = s.workers[0].onmessage({ data: execution(id) });
  s.control.cancel();
  release();
  await pending;
  assert.equal(s.workers.length, 1);
  assert.equal(s.completed.length, 0);
  assert(s.workers[0].terminated);
});
test("restarted run ignores late worker messages and errors", async () => {
  const s = setup(),
    old = s.control.start({}, {}),
    w = s.workers[0],
    lateMessage = w.onmessage,
    lateError = w.onerror;
  const latest = s.control.start({}, {});
  await lateMessage({ data: execution(old) });
  lateError({ message: "late failure" });
  assert.equal(s.control.active.id, latest);
  assert.equal(s.workers.length, 2);
  assert.equal(s.statuses.filter((x) => x.kind === "error").length, 0);
});
test("old execution worker errors cannot interrupt proof worker", async () => {
  const s = setup(),
    id = s.control.start({}, {}),
    lateError = s.workers[0].onerror;
  await s.workers[0].onmessage({ data: execution(id) });
  lateError({ message: "stale" });
  assert.equal(s.control.active.id, id);
  assert.equal(s.workers[1].terminated, false);
});
test("persistence failure ends run without starting prover", async () => {
  const s = setup(async () => {
      throw Error("receipt rejected");
    }),
    id = s.control.start({}, {});
  await s.workers[0].onmessage({ data: execution(id) });
  assert.equal(s.control.active, null);
  assert.equal(s.workers.length, 1);
  assert.match(s.statuses.at(-1).error, /receipt rejected/);
});
test("cancel while saving proof suppresses final success", async () => {
  let release;
  let count = 0;
  const s = setup(() =>
      ++count === 1 ? Promise.resolve() : new Promise((r) => (release = r)),
    ),
    id = s.control.start({}, {});
  await s.workers[0].onmessage({ data: execution(id) });
  const pending = s.workers[1].onmessage({
    data: { id, kind: "proof", ok: true },
  });
  s.control.cancel();
  release();
  await pending;
  assert.equal(s.completed.length, 0);
});
