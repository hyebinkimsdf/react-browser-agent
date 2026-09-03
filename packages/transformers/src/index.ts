import { transformersJS } from "@browser-ai/transformers-js";
import type { BrowserAIRuntime, RuntimeAvailability } from "@browser-ai-sdk/core";

export type TransformersDevice = "auto" | "webgpu" | "wasm" | "cpu";

export interface TransformersRuntimeOptions {
  /**
   * @default "auto" — Transformers.js resolves this to WebGPU when available,
   * falling back to WASM otherwise (verified in poc/RESULTS.md).
   */
  device?: TransformersDevice;
  worker?: Worker;
}

/**
 * Transformers Adapter (guide.md 13-③): implements Core's Runtime Interface
 * on top of `@browser-ai/transformers-js`. This is the only package allowed
 * to import that provider directly.
 */
export function createTransformersRuntime(
  modelId: string,
  options: TransformersRuntimeOptions = {},
): BrowserAIRuntime {
  const device = options.device ?? "auto";
  const ownsWorker = !options.worker;
  const worker =
    options.worker ??
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

  const model = transformersJS(modelId, { device, worker });

  return {
    modelId,

    availability(): Promise<RuntimeAvailability> {
      return model.availability();
    },

    async prepare(onProgress) {
      const availability = await model.availability();

      if (availability === "unavailable") {
        throw new Error(`"${modelId}" is not available on this device/browser.`);
      }

      if (availability === "downloadable") {
        await model.createSessionWithProgress((progress) => {
          onProgress?.(Math.round(progress * 100));
        });
      } else {
        onProgress?.(100);
      }

      return model;
    },

    dispose() {
      if (ownsWorker) worker.terminate();
    },
  };
}
