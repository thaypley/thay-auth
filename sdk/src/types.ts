export interface ThayUser {
  id: string;
  email: string;
  username: string;
  accountType: string;
  isVerified: boolean;
  isArchitect: boolean;
  tier: string;
  avatar: string;
  avatarVersion?: number;
  created: string;
  updated: string;
}

export interface PlatformInfo {
  slug: string;
  name: string;
  url: string;
  tagline: string;
  type: 'web' | 'desktop' | 'cli' | 'cloud' | 'mobile' | 'docs';
}

export interface Invite {
  id: string;
  code: string;
  used: boolean;
  usedBy: string;
  usedAt: string;
  maxUses: number;
  useCount: number;
  note: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateInviteOptions {
  maxUses?: number;
  note?: string;
  expiresAt?: string;
}

export interface UserProfile extends ThayUser {
  characteristics: Record<string, string>;
}

export interface AuthSession {
  user: ThayUser;
  token: string;
  sessionToken?: string;
  expiry?: number;
}

export interface DevicePairing {
  deviceToken: string;
  device: {
    id: string;
    label: string;
    scopes: string[];
    expiresAt: string;
  };
}

export interface Device {
  id: string;
  label: string;
  scopes: string[];
  lastSeenAt: string;
  expiresAt: string;
  revoked: boolean;
  created: string;
}

export interface Session {
  id: string;
  deviceId: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
}

export interface SignupData {
  email: string;
  password: string;
  username: string;
  accountType: string;
  birthday: string;
  inviteCode: string;
}

export interface UserApp {
  id: string;
  appId: string;
  appName: string;
  installedVersion: string;
  latestVersion: string;
  autoUpdate: boolean;
  status: string;
  syncUrl?: string;
  installedAt: string;
  lastUpdatedAt: string;
}

export interface ProfileUpdateData {
  username?: string;
  characteristics?: Record<string, string>;
}

export interface WaitlistData {
  email: string;
  note?: string;
  source?: string;
}

export type AuthStateListener = (user: ThayUser | null) => void;