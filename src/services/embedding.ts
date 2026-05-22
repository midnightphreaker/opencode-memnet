import { CONFIG } from "../config.js";
import { log } from "./logger.js";
import { join } from "node:path";

const TIMEOUT_MS = 30000;
const GLOBAL_EMBEDDING_KEY = Symbol.for("opencode-mem.embedding.instance");
const MAX_CACHE_SIZE = 100;
const CHARS_PER_TOKEN = 4;

type XenovaTransformers = typeof import("@xenova/transformers");

let _transformers: {
  pipeline: XenovaTransformers["pipeline"];
  env: XenovaTransformers["env"];
} | null = null;

function getTransformersPackageSpecifier(): string {
  // Keep this non-literal so OpenCode/Bun plugin-loader bundling does not eagerly
  // traverse @xenova/transformers internals during plugin startup. The package
  // is only needed for the local embedding backend, and should stay lazy.
  return ["@xenova", "transformers"].join("/");
}

async function ensureTransformersLoaded(): Promise<NonNullable<typeof _transformers>> {
  if (_transformers !== null) return _transformers;
  const mod = (await import(getTransformersPackageSpecifier())) as XenovaTransformers;
  mod.env.allowLocalModels = true;
  mod.env.allowRemoteModels = true;
  mod.env.cacheDir = join(CONFIG.storagePath, ".cache");
  // Keep ONNX WASM single-threaded for Bun/Node runtimes without SharedArrayBuffer.
  try {
    (mod.env as any).backends.onnx.wasm.numThreads = 1;
  } catch (e) {
    log("Failed to set wasm.numThreads", { error: String(e) });
  }
  _transformers = mod;
  return _transformers!;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
  ]);
}

export type EmbeddingKind = "content" | "tags" | "query" | "migration";

export interface EmbeddingOptions {
  kind?: EmbeddingKind;
  truncationSide?: "left" | "right";
}

function resolveMaxTokens(kind: EmbeddingKind): number {
  return CONFIG.embeddingMaxTokens[kind] ?? 2048;
}

function resolveTruncationSide(kind: EmbeddingKind, side?: "left" | "right"): "left" | "right" {
  return side ?? CONFIG.embeddingTruncationSide[kind] ?? "right";
}

function truncateText(text: string, maxTokens: number, side: "left" | "right"): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  if (side === "right") {
    // Keep the beginning
    return text.slice(0, maxChars);
  }
  // Left: keep the end
  return text.slice(text.length - maxChars);
}

export class EmbeddingService {
  private pipe: any = null;
  private initPromise: Promise<void> | null = null;
  public isWarmedUp: boolean = false;
  private cache: Map<string, Float32Array> = new Map();
  private cachedModelName: string | null = null;

  static getInstance(): EmbeddingService {
    if (!(globalThis as any)[GLOBAL_EMBEDDING_KEY]) {
      (globalThis as any)[GLOBAL_EMBEDDING_KEY] = new EmbeddingService();
    }
    return (globalThis as any)[GLOBAL_EMBEDDING_KEY];
  }

  async warmup(progressCallback?: (progress: any) => void): Promise<void> {
    if (this.isWarmedUp) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initializeModel(progressCallback);
    return this.initPromise;
  }

  private async initializeModel(progressCallback?: (progress: any) => void): Promise<void> {
    try {
      if (CONFIG.embeddingApiUrl && CONFIG.embeddingApiKey) {
        this.isWarmedUp = true;
        return;
      }
      const { pipeline } = await ensureTransformersLoaded();
      this.pipe = await pipeline("feature-extraction", CONFIG.embeddingModel, {
        progress_callback: progressCallback,
      });
      this.isWarmedUp = true;
    } catch (error) {
      this.initPromise = null;
      log("Failed to initialize embedding model", { error: String(error) });
      throw error;
    }
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<Float32Array> {
    if (this.cachedModelName !== CONFIG.embeddingModel) {
      this.clearCache();
      this.cachedModelName = CONFIG.embeddingModel;
    }

    const kind: EmbeddingKind = options?.kind ?? "content";
    const maxTokens = resolveMaxTokens(kind);
    const side = resolveTruncationSide(kind, options?.truncationSide);

    // Truncate before cache lookup
    const effectiveText = truncateText(text, maxTokens, side);

    // Cache key includes model, kind, maxTokens, side, and truncated/effective text
    const cacheKey = `${CONFIG.embeddingModel}:${kind}:${maxTokens}:${side}:${effectiveText}`;

    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!this.isWarmedUp && !this.initPromise) {
      await this.warmup();
    }
    if (this.initPromise) {
      await this.initPromise;
    }

    let result: Float32Array;
    const isRemote = !!(CONFIG.embeddingApiUrl && CONFIG.embeddingApiKey);

    if (isRemote) {
      if (side === "left") {
        // For remote API with left truncation, pass truncate_prompt_tokens and try to avoid
        // app-side truncation if possible (let the server do it).
        // We still need to pass effectiveText as input; for left, effectiveText already has
        // the beginning trimmed. We send truncate_prompt_tokens so the API can further truncate.
        const response = await fetch(`${CONFIG.embeddingApiUrl}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CONFIG.embeddingApiKey}`,
          },
          body: JSON.stringify({
            input: text.length > effectiveText.length ? effectiveText : text,
            model: CONFIG.embeddingModel,
            truncate_prompt_tokens: maxTokens,
          }),
        });

        if (!response.ok) {
          throw new Error(`API embedding failed: ${response.statusText}`);
        }

        const data: any = await response.json();
        result = new Float32Array(data.data[0].embedding);
      } else {
        // Right truncation: app-side already done, do not send truncate_prompt_tokens
        const response = await fetch(`${CONFIG.embeddingApiUrl}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CONFIG.embeddingApiKey}`,
          },
          body: JSON.stringify({
            input: effectiveText,
            model: CONFIG.embeddingModel,
          }),
        });

        if (!response.ok) {
          throw new Error(`API embedding failed: ${response.statusText}`);
        }

        const data: any = await response.json();
        result = new Float32Array(data.data[0].embedding);
      }
    } else {
      // Local pipeline: always app-truncate (effectiveText already is truncated)
      const output = await this.pipe(effectiveText, { pooling: "mean", normalize: true });
      result = new Float32Array(output.data);
    }

    if (this.cache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, result);

    return result;
  }

  async embedWithTimeout(text: string, options?: EmbeddingOptions): Promise<Float32Array> {
    return withTimeout(this.embed(text, options), TIMEOUT_MS);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const embeddingService = EmbeddingService.getInstance();
