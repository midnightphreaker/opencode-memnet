import crypto, { randomBytes, randomUUID } from "node:crypto";
import type {
  MemoryBankRepository,
  MemoryBankRow,
  UserApiKeyRepository,
  UserApiKeyRow,
} from "./storage/types.js";

export type AdminPrincipal = { kind: "admin" };

export type UserApiKeyPrincipal = {
  kind: "user-api-key";
  apiKeyId: string;
  apiKeyName: string;
  apiKeyDescription: string;
};

export type Principal = AdminPrincipal | UserApiKeyPrincipal;

export type CreatedUserApiKey = {
  apiKey: Omit<UserApiKeyRow, "apiKeyHash">;
  value: string;
};

export function timingSafeEqualString(actual: string, expected: string): boolean {
  const actualDigest = crypto.createHash("sha256").update(actual).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

export function generateUserApiKeyValue(): string {
  return `omnu_${randomBytes(32).toString("base64url")}`;
}

export function principalResponse(principal: Principal): Principal {
  return principal.kind === "user-api-key"
    ? {
        kind: "user-api-key",
        apiKeyId: principal.apiKeyId,
        apiKeyName: principal.apiKeyName,
        apiKeyDescription: principal.apiKeyDescription,
      }
    : { kind: "admin" };
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function publicApiKey(row: UserApiKeyRow): Omit<UserApiKeyRow, "apiKeyHash"> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

export class AuthService {
  private readonly serverApiKey: string;
  private readonly userApiKeyRepo: UserApiKeyRepository;
  private readonly memoryBankRepo: MemoryBankRepository;

  constructor(args: {
    serverApiKey: string;
    userApiKeyRepo: UserApiKeyRepository;
    memoryBankRepo: MemoryBankRepository;
  }) {
    this.serverApiKey = requireNonEmpty(args.serverApiKey, "SERVER_API_KEY is required");
    this.userApiKeyRepo = args.userApiKeyRepo;
    this.memoryBankRepo = args.memoryBankRepo;
  }

  async authenticateBearer(key: string): Promise<Principal | null> {
    if (timingSafeEqualString(key, this.serverApiKey)) return { kind: "admin" };
    const row = await this.userApiKeyRepo.findByApiKey(key);
    if (!row) return null;
    await this.userApiKeyRepo.touchLastUsed(row.id);
    return {
      kind: "user-api-key",
      apiKeyId: row.id,
      apiKeyName: row.name,
      apiKeyDescription: row.description,
    };
  }

  async createUserApiKey(args: { name: string; description: string }): Promise<CreatedUserApiKey> {
    const name = requireNonEmpty(args.name, "API key name is required");
    const description = requireNonEmpty(args.description, "API key description is required");
    const value = generateUserApiKeyValue();
    const row = await this.userApiKeyRepo.create({
      id: randomUUID(),
      name,
      description,
      apiKeyValue: value,
    });
    return { apiKey: publicApiKey(row), value };
  }

  async listUserApiKeys(): Promise<Omit<UserApiKeyRow, "apiKeyHash">[]> {
    return (await this.userApiKeyRepo.list()).map(publicApiKey);
  }

  async listMemoryBanks(principal: UserApiKeyPrincipal): Promise<MemoryBankRow[]> {
    return this.memoryBankRepo.listForApiKey(principal.apiKeyId);
  }

  async listMemoryBanksForApiKey(apiKeyId: string): Promise<MemoryBankRow[]> {
    return this.memoryBankRepo.listForApiKey(apiKeyId);
  }

  async createMemoryBankForApiKey(args: {
    apiKeyId: string;
    name: string;
    description: string;
  }): Promise<MemoryBankRow> {
    const name = requireNonEmpty(args.name, "Memory Bank name is required");
    const description = requireNonEmpty(args.description, "Memory Bank description is required");
    return this.memoryBankRepo.create({
      id: randomUUID(),
      apiKeyId: args.apiKeyId,
      name,
      description,
    });
  }

  async updateUserApiKey(args: {
    id: string;
    name?: string;
    description?: string;
  }): Promise<Omit<UserApiKeyRow, "apiKeyHash"> | null> {
    const row = await this.userApiKeyRepo.update(args);
    return row ? publicApiKey(row) : null;
  }

  async revokeUserApiKey(id: string): Promise<boolean> {
    return this.userApiKeyRepo.revoke(id);
  }

  async updateMemoryBank(args: {
    id: string;
    name?: string;
    description?: string;
  }): Promise<MemoryBankRow | null> {
    return this.memoryBankRepo.update(args);
  }

  async deleteMemoryBank(id: string): Promise<boolean> {
    return this.memoryBankRepo.delete(id);
  }

  async requireBankForPrincipal(
    principal: Principal,
    memoryBankId: string | undefined
  ): Promise<MemoryBankRow> {
    const id = requireNonEmpty(memoryBankId ?? "", "X-Memory-Bank-ID is required");
    if (principal.kind === "admin") {
      const bank = await this.memoryBankRepo.getById(id);
      if (!bank) throw new Error("Memory Bank not found");
      return bank;
    }
    const bank = await this.memoryBankRepo.getForApiKey({
      apiKeyId: principal.apiKeyId,
      memoryBankId: id,
    });
    if (!bank) throw new Error("Memory Bank not found for API key");
    return bank;
  }
}
