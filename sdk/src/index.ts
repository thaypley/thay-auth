import type {
  ThayUser, UserProfile, AuthSession, DevicePairing, Device,
  Session, SignupData, UserApp, ProfileUpdateData,
  AuthStateListener, PlatformInfo, Invite, CreateInviteOptions,
  Entitlements,
} from './types.js';

export type {
  ThayUser, UserProfile, AuthSession, DevicePairing, Device,
  Session, SignupData, UserApp, ProfileUpdateData,
  PlatformInfo, Invite, CreateInviteOptions, Entitlements,
};

export class ThayAuth {
  private baseUrl: string;
  private token: string | null = null;
  private user: ThayUser | null = null;
  private listeners: Set<AuthStateListener> = new Set();

  constructor(config: { baseUrl: string }) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  getToken(): string | null {
    return this.token;
  }

  getUser(): ThayUser | null {
    return this.user;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  onAuthStateChange(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(user: ThayUser | null) {
    for (const listener of this.listeners) {
      try { listener(user); } catch { /* ignore */ }
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Request failed: ${res.status}`);
    }

    return data as T;
  }

  // ─── Auth ──────────────────────────────────────────────────────────

  async login(identity: string, password: string): Promise<AuthSession> {
    const data = await this.request<AuthSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identity, password }),
    });
    this.token = data.sessionToken || data.token;
    this.user = data.user;
    this.notify(this.user);
    return data;
  }

  async signup(data: SignupData): Promise<AuthSession> {
    const result = await this.request<AuthSession>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    this.token = result.token;
    this.user = result.user;
    this.notify(this.user);
    return result;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    this.token = null;
    this.user = null;
    this.notify(null);
  }

  async refreshSession(): Promise<AuthSession> {
    const data = await this.request<AuthSession>('/auth/refresh', {
      method: 'POST',
    });
    this.token = data.sessionToken || data.token;
    this.user = data.user;
    return data;
  }

  async getMe(): Promise<ThayUser> {
    return this.request<ThayUser>('/auth/me');
  }

  // ─── Profile ───────────────────────────────────────────────────────

  async getProfile(): Promise<UserProfile> {
    return this.request<UserProfile>('/auth/profile');
  }

  async updateProfile(data: ProfileUpdateData): Promise<UserProfile> {
    const result = await this.request<UserProfile>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (result.username) {
      this.user = result;
    }
    return result;
  }

  // ─── Characteristics ───────────────────────────────────────────────

  async getCharacteristics(): Promise<Record<string, string>> {
    const data = await this.request<{ characteristics: Record<string, string> }>('/auth/profile/characteristics');
    return data.characteristics;
  }

  async setCharacteristics(characteristics: Record<string, string>): Promise<Record<string, string>> {
    const data = await this.request<{ characteristics: Record<string, string> }>('/auth/profile/characteristics', {
      method: 'PUT',
      body: JSON.stringify({ characteristics }),
    });
    return data.characteristics;
  }

  // ─── Username ──────────────────────────────────────────────────────

  async checkUsername(username: string): Promise<{ available: boolean; error?: string }> {
    return this.request(`/auth/check-username?username=${encodeURIComponent(username)}`);
  }

  async changeUsername(username: string): Promise<{ user: ThayUser }> {
    return this.request('/auth/change-username', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  }

  // ─── Invite & Waitlist ─────────────────────────────────────────────

  async checkInviteCode(code: string): Promise<{ valid: boolean; error?: string }> {
    return this.request('/auth/check-invite', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  // Architect-only invite minting — requires a token whose user has
  // isArchitect=true. The API enforces this server-side.
  async listInvites(): Promise<Invite[]> {
    const data = await this.request<{ invites: Invite[] }>('/auth/invites');
    return data.invites;
  }

  async createInvite(options: CreateInviteOptions = {}): Promise<Invite> {
    const data = await this.request<{ invite: Invite }>('/auth/invites', {
      method: 'POST',
      body: JSON.stringify(options),
    });
    return data.invite;
  }

  async deleteInvite(id: string): Promise<void> {
    await this.request(`/auth/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async joinWaitlist(email: string, note?: string, source?: string): Promise<{ success: boolean; id?: string; message: string }> {
    return this.request('/auth/waitlist', {
      method: 'POST',
      body: JSON.stringify({ email, note: note || '', source: source || 'homebase' }),
    });
  }

  // ─── Email Verification ────────────────────────────────────────────

  async sendVerificationEmail(): Promise<void> {
    await this.request('/auth/send-verification', { method: 'POST' });
  }

  async verifyEmail(code: string): Promise<void> {
    await this.request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    await this.request('/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  // ─── Apps ──────────────────────────────────────────────────────────

  async getApps(): Promise<UserApp[]> {
    const data = await this.request<{ apps: UserApp[] }>('/auth/apps');
    return data.apps;
  }

  async registerApp(appId: string, appName?: string, installedVersion?: string, autoUpdate?: boolean, syncUrl?: string): Promise<UserApp> {
    const data = await this.request<{ app: UserApp }>('/auth/apps', {
      method: 'POST',
      body: JSON.stringify({ appId, appName, installedVersion, autoUpdate, ...(syncUrl ? { syncUrl } : {}) }),
    });
    return data.app;
  }

  async uninstallApp(appId: string): Promise<void> {
    await this.request(`/auth/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' });
  }

  // ─── Platforms ─────────────────────────────────────────────────────

  async getPlatforms(): Promise<PlatformInfo[]> {
    const data = await this.request<{ platforms: PlatformInfo[] }>('/auth/platforms');
    return data.platforms;
  }

  // ─── Catalog ───────────────────────────────────────────────────────

  async getCatalog(): Promise<Array<{
    slug: string;
    displayName: string;
    tagline?: string;
    description?: string;
    iconUrl?: string;
    isFree?: boolean;
    price?: string;
    version?: string;
    kind?: string;
    downloads: Record<string, string>;
  }>> {
    const data = await this.request<{ apps: Array<{ slug: string; displayName: string; tagline?: string; description?: string; iconUrl?: string; isFree?: boolean; price?: string; version?: string; kind?: string; downloads: Record<string, string> }> }>('/auth/catalog');
    return data.apps;
  }

  // ─── Entitlements (base membership + app add-ons) ─────────────────
  // Server truth only — never cached to localStorage by callers. The
  // in-memory TTL below is a request-coalescing courtesy, not a grant.

  private entitlementsCache: { data: Entitlements; fetchedAt: number } | null = null;
  private static ENTITLEMENTS_TTL_MS = 60_000;

  async getEntitlements(opts: { fresh?: boolean } = {}): Promise<Entitlements> {
    if (
      !opts.fresh &&
      this.entitlementsCache &&
      Date.now() - this.entitlementsCache.fetchedAt < ThayAuth.ENTITLEMENTS_TTL_MS
    ) {
      return this.entitlementsCache.data;
    }
    const data = await this.request<Entitlements>('/auth/entitlements');
    this.entitlementsCache = { data, fetchedAt: Date.now() };
    return data;
  }

  /**
   * Gate verdict for thaypley.com — and every platform, mid-trial.
   * Resolves when the account is an architect, holds an active base
   * membership, or is mid-trial. The 30-day trial is the free test
   * point and spreads across ALL platforms and apps (see
   * entitlements.trialCoversAll). Rejects with the entitlement snapshot
   * attached (err.entitlements) so callers can render trialDaysLeft /
   * past_due states at the wall.
   */
  async requireBase(): Promise<Entitlements> {
    const e = await this.getEntitlements({ fresh: true });
    if (e.architect || e.base.status === 'active' || e.base.status === 'trialing') return e;
    throw Object.assign(new Error('Base membership required'), { entitlements: e });
  }

  /**
   * One 30-day trial per account, forever. Starts the free test point,
   * which unlocks every platform AND every app for the trial window
   * (entitlements.trialCoversAll). Re-invocation reports the existing
   * state instead of restarting the clock.
   */
  async startBaseTrial(): Promise<{ ok: boolean; architect?: boolean; alreadyStarted?: boolean; entitlements: Entitlements }> {
    const result = await this.request<{ ok: boolean; architect?: boolean; alreadyStarted?: boolean; entitlements: Entitlements }>('/auth/subscription/start-trial', {
      method: 'POST',
    });
    if (result.entitlements) {
      this.entitlementsCache = { data: result.entitlements, fetchedAt: Date.now() };
    }
    return result;
  }

  async checkoutMembership(target: 'base' | `app:${string}`): Promise<{ url: string; mode: string; sessionId: string }> {
    return this.request('/auth/subscription/checkout', {
      method: 'POST',
      body: JSON.stringify({ target }),
    });
  }

  async openBillingPortal(returnUrl?: string): Promise<{ url: string; mode: string }> {
    return this.request('/auth/subscription/portal', {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
    });
  }

  // ─── Devices ───────────────────────────────────────────────────────

  async pairDevice(label: string, scopes?: string[]): Promise<DevicePairing> {
    return this.request<DevicePairing>('/devices/pair', {
      method: 'POST',
      body: JSON.stringify({ label, scopes }),
    });
  }

  async unpairDevice(deviceToken: string): Promise<void> {
    await this.request('/devices/unpair', {
      method: 'DELETE',
      body: JSON.stringify({ deviceToken }),
    });
  }

  async listDevices(): Promise<Device[]> {
    const data = await this.request<{ devices: Device[] }>('/devices');
    return data.devices;
  }

  async verifyDeviceToken(deviceToken: string): Promise<{ valid: boolean; userId?: string; deviceId?: string; scopes?: string[] }> {
    return this.request('/devices/verify', {
      method: 'POST',
      body: JSON.stringify({ deviceToken }),
    });
  }

  // ─── Sessions ──────────────────────────────────────────────────────

  async listSessions(): Promise<Session[]> {
    const data = await this.request<{ sessions: Session[] }>('/sessions');
    return data.sessions;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.request(`/sessions/${sessionId}`, { method: 'DELETE' });
  }

  // ─── Health ────────────────────────────────────────────────────────

  async healthCheck(): Promise<{ status: string }> {
    return this.request('/auth/health');
  }
}