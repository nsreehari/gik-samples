import { setTimeout } from "node:timers/promises";
import { createMemoryStorage } from "gik-durable-runtime/storage/memory";
import { openSenseClockHost } from "./senses-clock-host";

const ref = `b64:${Buffer.from(JSON.stringify({ kind: "memory", value: "senses-demo" })).toString("base64url")}`;
const host = await openSenseClockHost({
  runtimeId: "senses-demo",
  providerKind: "memory",
  provider: createMemoryStorage(),
  refs: { stateRef: ref, journalRef: ref, effectsQueueRef: ref },
  onError(error) { console.error("Sense host failed:", error); },
});
try {
  for (let index = 0; index < 5; index++) {
    await setTimeout(120);
    const saved = await host.snapshot();
    console.log(JSON.stringify({ counter: saved.state.counter, report: saved.state.report }));
  }
} finally {
  await host.close();
}
