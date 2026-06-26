import { basename, resolve } from "node:path";

export interface SuggestedMemoryBank {
  name: string;
  description: string;
}

export interface MemoryBankStateKeyInput {
  serverUrl: string;
  apiKeyName: string;
  cwd: string;
}

export interface SelectableMemoryBank {
  id: string;
}

const MAGIC_RE =
  /^!opencode-memnet!New memory bank called ['"]([^'"]+)['"], create it, and activate it!$/i;

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, "-").toLowerCase();
}

export function suggestMemoryBank(cwd: string): SuggestedMemoryBank {
  const name = cleanName(basename(resolve(cwd)) || "workspace");
  return {
    name,
    description: `Work done on ${name} repo`,
  };
}

export function parseMagicMemoryBankPrompt(input: string): SuggestedMemoryBank | null {
  const match = input.trim().match(MAGIC_RE);
  if (!match) return null;
  const name = cleanName(match[1] ?? "");
  if (!name) return null;
  return {
    name,
    description: `work relating to ${name}`,
  };
}

export function stateKeyForMemoryBank(input: MemoryBankStateKeyInput): string {
  return `${input.serverUrl.replace(/\/+$/, "")}|${input.apiKeyName}|${resolve(input.cwd)}`;
}

export function selectMemoryBank<T extends SelectableMemoryBank>(
  banks: T[],
  configuredMemoryBankId?: string
): T | null {
  const id = configuredMemoryBankId?.trim();
  if (!id) return banks[0] ?? null;
  return banks.find((bank) => bank.id === id) ?? null;
}
