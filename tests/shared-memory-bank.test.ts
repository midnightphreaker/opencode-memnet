import { describe, expect, it } from "bun:test";
import {
  parseMagicMemoryBankPrompt,
  selectMemoryBank,
  suggestMemoryBank,
  stateKeyForMemoryBank,
} from "../shared/memory-bank.js";

describe("shared Memory Bank helpers", () => {
  it("suggests a bank from the current directory", () => {
    expect(suggestMemoryBank("/home/phrkr/Workspace/vllm-setup")).toEqual({
      name: "vllm-setup",
      description: "Work done on vllm-setup repo",
    });
  });

  it("parses the magic Memory Bank creation prompt", () => {
    expect(
      parseMagicMemoryBankPrompt(
        "!opencode-memnet!New memory bank called 'new-project', create it, and activate it!"
      )
    ).toEqual({
      name: "new-project",
      description: "work relating to new-project",
    });
  });

  it("ignores normal prompts", () => {
    expect(parseMagicMemoryBankPrompt("create a database migration")).toBeNull();
  });

  it("builds a stable state key without using the secret API key value", () => {
    expect(
      stateKeyForMemoryBank({
        serverUrl: "https://memory.example",
        apiKeyName: "opencode",
        cwd: "/home/phrkr/Workspace/vllm-setup",
      })
    ).toBe("https://memory.example|opencode|/home/phrkr/Workspace/vllm-setup");
  });

  it("selects configured Memory Bank IDs and otherwise falls back to the first bank", () => {
    const banks = [{ id: "bank-1" }, { id: "bank-2" }];

    expect(selectMemoryBank(banks)?.id).toBe("bank-1");
    expect(selectMemoryBank(banks, "bank-2")?.id).toBe("bank-2");
    expect(selectMemoryBank(banks, "missing-bank")).toBeNull();
  });
});
