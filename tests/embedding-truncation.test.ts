import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { CONFIG } from "../src/config.js";

// We test embedding truncation logic by importing the service and verifying behavior
// through mock fetch and cache interactions.

const { EmbeddingService, embeddingService } = await import("../src/services/embedding.js");

describe("EmbeddingService truncation and caching", () => {
  let service: InstanceType<typeof EmbeddingService>;
  let fetchSpy: ReturnType<typeof spyOn>;
  let originalApiUrl: string | undefined;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    // Create a fresh instance for each test
    service = new (EmbeddingService as any)() as InstanceType<typeof EmbeddingService>;
    service.clearCache();
    // Force warmup state (pretend API mode is ready)
    (service as any).isWarmedUp = true;

    originalApiUrl = CONFIG.embeddingApiUrl;
    originalApiKey = CONFIG.embeddingApiKey;
    // Enable remote API mode for fetch-based tests
    (CONFIG as any).embeddingApiUrl = "https://mock-api.test/v1";
    (CONFIG as any).embeddingApiKey = "test-key";
  });

  afterEach(() => {
    service.clearCache();
    fetchSpy?.mockRestore();
    (CONFIG as any).embeddingApiUrl = originalApiUrl;
    (CONFIG as any).embeddingApiKey = originalApiKey;
  });

  function mockFetchResponse(embedding: number[]) {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding }],
      }),
    } as any);
  }

  it("right truncation: app-truncates input, does not send truncate_prompt_tokens", async () => {
    const longText = "A".repeat(10000); // ~2500 tokens, exceeds default content max of 2048
    const embedding = new Array(768).fill(0.1);
    mockFetchResponse(embedding);

    const result = await service.embed(longText, { kind: "content" });

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(768);

    // Verify fetch was called
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as any).body);

    // Right truncation: app-side, no truncate_prompt_tokens
    expect(body.truncate_prompt_tokens).toBeUndefined();
    // The input should be truncated (8192 chars = 2048 tokens * 4 chars/token)
    expect(body.input.length).toBeLessThan(longText.length);
  });

  it("left truncation: sends truncate_prompt_tokens to remote API", async () => {
    const longText = "B".repeat(10000);
    const embedding = new Array(768).fill(0.2);
    mockFetchResponse(embedding);

    const result = await service.embed(longText, { kind: "content", truncationSide: "left" });

    expect(result).toBeInstanceOf(Float32Array);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as any).body);

    // Left truncation: sends truncate_prompt_tokens
    expect(body.truncate_prompt_tokens).toBe(CONFIG.embeddingMaxTokens.content);
  });

  it("cache differentiates same raw text by kind", async () => {
    const text = "shared text for cache test";
    const embeddingContent = new Array(768).fill(0.3);
    const embeddingQuery = new Array(768).fill(0.4);

    // First call: kind=content
    mockFetchResponse(embeddingContent);
    const result1 = await service.embed(text, { kind: "content" });

    // Second call: kind=query (different embedding values to prove different call)
    fetchSpy.mockRestore();
    mockFetchResponse(embeddingQuery);
    const result2 = await service.embed(text, { kind: "query" });

    // Both should have been fetched (not cached) since kind differs
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result1[0]).toBeCloseTo(0.3);
    expect(result2[0]).toBeCloseTo(0.4);
  });

  it("cache differentiates same text by truncation side", async () => {
    const text = "X".repeat(5000);
    const embeddingRight = new Array(768).fill(0.5);
    const embeddingLeft = new Array(768).fill(0.6);

    // First call: right
    mockFetchResponse(embeddingRight);
    const result1 = await service.embed(text, { kind: "content", truncationSide: "right" });

    // Second call: left
    fetchSpy.mockRestore();
    mockFetchResponse(embeddingLeft);
    const result2 = await service.embed(text, { kind: "content", truncationSide: "left" });

    // Both should have been fetched since truncation side differs
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result1[0]).toBeCloseTo(0.5);
    expect(result2[0]).toBeCloseTo(0.6);
  });

  it("returns cached result for identical kind and text", async () => {
    const text = "cache hit test";
    const embedding = new Array(768).fill(0.7);
    mockFetchResponse(embedding);

    const result1 = await service.embed(text, { kind: "content" });
    const result2 = await service.embed(text, { kind: "content" });

    // Only one fetch call; second should be a cache hit
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result1).toBe(result2);
  });

  it("short text is not truncated for right side", async () => {
    const shortText = "hello world";
    const embedding = new Array(768).fill(0.8);
    mockFetchResponse(embedding);

    await service.embed(shortText, { kind: "content" });

    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(body.input).toBe(shortText);
    expect(body.truncate_prompt_tokens).toBeUndefined();
  });
});
