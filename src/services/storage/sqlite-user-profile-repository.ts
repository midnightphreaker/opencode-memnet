/**
 * SQLite-backed implementation of UserProfileRepository.
 * Wraps the existing UserProfileManager singleton.
 */

import { userProfileManager } from "../user-profile/user-profile-manager.js";
import type {
  UserProfileRepository,
  UserProfileRow,
  UserProfileChangelogRow,
  UserProfileData,
} from "./types.js";

function profileToRow(p: any): UserProfileRow {
  return {
    id: p.id,
    userId: p.userId,
    displayName: p.displayName,
    userName: p.userName,
    userEmail: p.userEmail,
    profileData: p.profileData,
    version: p.version,
    createdAt: p.createdAt,
    lastAnalyzedAt: p.lastAnalyzedAt,
    totalPromptsAnalyzed: p.totalPromptsAnalyzed,
    isActive: p.isActive,
  };
}

function changelogToRow(c: any): UserProfileChangelogRow {
  return {
    id: c.id,
    profileId: c.profileId,
    version: c.version,
    changeType: c.changeType,
    changeSummary: c.changeSummary,
    profileDataSnapshot: c.profileDataSnapshot,
    createdAt: c.createdAt,
  };
}

export class SqliteUserProfileRepository implements UserProfileRepository {
  async initialize(): Promise<void> {
    // UserProfileManager is initialized at module-load time.
  }

  async close(): Promise<void> {
    // No-op: connection lifecycle is managed by connectionManager.
  }

  async getActiveProfile(userId: string): Promise<UserProfileRow | null> {
    const p = userProfileManager.getActiveProfile(userId);
    return p ? profileToRow(p) : null;
  }

  async getProfileById(profileId: string): Promise<UserProfileRow | null> {
    const p = userProfileManager.getProfileById(profileId);
    return p ? profileToRow(p) : null;
  }

  async getAllActiveProfiles(): Promise<UserProfileRow[]> {
    return userProfileManager.getAllActiveProfiles().map(profileToRow);
  }

  async createProfile(
    userId: string,
    displayName: string,
    userName: string,
    userEmail: string,
    profileData: UserProfileData,
    promptsAnalyzed: number
  ): Promise<string> {
    return userProfileManager.createProfile(
      userId,
      displayName,
      userName,
      userEmail,
      profileData,
      promptsAnalyzed
    );
  }

  async updateProfile(
    profileId: string,
    profileData: UserProfileData,
    additionalPromptsAnalyzed: number,
    changeSummary: string
  ): Promise<void> {
    userProfileManager.updateProfile(
      profileId,
      profileData,
      additionalPromptsAnalyzed,
      changeSummary
    );
  }

  async deleteProfile(profileId: string): Promise<void> {
    userProfileManager.deleteProfile(profileId);
  }

  async applyConfidenceDecay(profileId: string): Promise<void> {
    userProfileManager.applyConfidenceDecay(profileId);
  }

  async getProfileChangelogs(
    profileId: string,
    limit: number = 10
  ): Promise<UserProfileChangelogRow[]> {
    return userProfileManager.getProfileChangelogs(profileId, limit).map(changelogToRow);
  }

  mergeProfileData(existing: UserProfileData, updates: Partial<UserProfileData>): UserProfileData {
    return userProfileManager.mergeProfileData(existing, updates);
  }
}
