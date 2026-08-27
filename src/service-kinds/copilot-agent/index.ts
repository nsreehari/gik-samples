import type { ServiceKindManifest } from "@gik-ai/controlface/services";
import { createWorkerServiceKind } from "../worker-service-kind";
import manifestJson from "./manifest.json";

export const copilotAgentKind = createWorkerServiceKind(manifestJson as ServiceKindManifest);
