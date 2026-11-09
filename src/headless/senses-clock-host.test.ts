import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createMemoryStorage } from "gik-durable-runtime/storage/memory";
import { openSenseClockHost } from "./senses-clock-host";

test("timer Signals drive durable source work and support disable, re-enable and host restart", async () => {
  vi.useFakeTimers();
  const errors: unknown[] = [];
  const ref = `b64:${Buffer.from(JSON.stringify({ kind: "memory", value: "sense-clock" })).toString("base64url")}`;
  const options = {
    runtimeId: "sense-clock", providerKind: "memory", provider: createMemoryStorage(),
    refs: { stateRef: ref, journalRef: ref, effectsQueueRef: ref },
    onError(error: unknown) { errors.push(error); },
  };
  let host: Awaited<ReturnType<typeof openSenseClockHost>> | undefined;
  try {
    host = await openSenseClockHost(options);
    await vi.advanceTimersByTimeAsync(350);
    let saved = await host.snapshot();
    assert.deepEqual(saved.state.counter, { value: 3 });
    assert.deepEqual(saved.state.report, { latest: { reviewedThroughTick: 3 } });
    const generation = Object.values(saved.spec.senses!.bindings)[0]!.generation;
    await host.configure(false, 100);
    await vi.advanceTimersByTimeAsync(350);
    saved = await host.snapshot();
    assert.deepEqual(saved.state.counter, { value: 3 });
    assert.deepEqual(saved.spec.senses!.bindings, {});
    await host.configure(true, 100);
    await vi.advanceTimersByTimeAsync(150);
    saved = await host.snapshot();
    assert.deepEqual(saved.state.counter, { value: 4 });
    assert.ok(Object.values(saved.spec.senses!.bindings)[0]!.generation > generation);
    await host.close();
    host = await openSenseClockHost(options);
    assert.deepEqual((await host.snapshot()).state.counter, { value: 4 });
    await vi.advanceTimersByTimeAsync(150);
    saved = await host.snapshot();
    assert.deepEqual(saved.state.counter, { value: 5 });
    assert.deepEqual(saved.state.report, { latest: { reviewedThroughTick: 5 } });
    assert.deepEqual(errors, []);
  } finally {
    await host?.close();
    vi.useRealTimers();
  }
});
