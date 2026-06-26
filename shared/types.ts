export type MemoryType = string;

export interface MemoryMetadata {
  type?: MemoryType;
  source?: "manual" | "auto-capture" | "import" | "api";
  tool?: string;
  sessionID?: string;
  reasoning?: string;
  captureTimestamp?: number;
  promptId?: string;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  [key: string]: unknown;
}

export type AIProviderType = "openai-chat";

export interface UserApiKeyPrincipalDTO {
  kind: "user-api-key";
  apiKeyId: string;
  apiKeyName: string;
  apiKeyDescription: string;
}

export interface MemoryBankDTO {
  id: string;
  apiKeyId: string;
  name: string;
  description: string;
  shortcut: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientConnectResponseDTO {
  principal: UserApiKeyPrincipalDTO;
  memoryBanks: MemoryBankDTO[];
  requiresMemoryBank: boolean;
  stats?: {
    memoryBankId: string;
    totalMemories: number;
    memoriesToday: number;
    totalPrompts: number;
  };
}

export interface CreateMemoryBankRequestDTO {
  name: string;
  description: string;
}
