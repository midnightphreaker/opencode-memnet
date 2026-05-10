import { describe, expect, it } from "bun:test";
import pkg from "../package.json";

describe("published dependency constraints", () => {
  it("pins @huggingface/transformers instead of floating to newer package layouts", () => {
    expect(pkg.dependencies["@huggingface/transformers"]).toBe("4.0.1");
  });
});
