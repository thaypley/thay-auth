export interface ThayUser {
  id: string;
  email: string;
  username: string;
  accountType: string;
  isVerified: boolean;
  isArchitect: boolean;
  tier: string;
  avatar: string;
  created: string;
  updated: string;
}

export interface UserProfile extends ThayUser {
  characteristics: Record<string, string>;
}

export interface AuthSession {
  user: ThayUser;
  token: string;
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