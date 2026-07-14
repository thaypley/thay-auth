import type {
  ThayUser, AuthSession, DevicePairing, Device,
  Session, SignupData, AuthStateListener,
} from './types.js';

export type { ThayUser, AuthSession, DevicePairing, Device, Session, SignupData };

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

  async login(identity: string, password: string): Promise<AuthSession> {
    const data = await this.request<AuthSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identity, password }),
    });
    this.token = data.token;
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
    this.token = data.token;
    this.user = data.user;
    return data;
  }

  async getMe(): Promise<ThayUser> {
    return this.request<ThayUser>('/auth/me');
  }

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

  async checkInviteCode(code: string): Promise<{ valid: boolean; error?: string }> {
    return this.request('/auth/check-invite', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

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

  async listSessions(): Promise<Session[]> {
    const data = await this.request<{ sessions: Session[] }>('/sessions');
    return data.sessions;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.request(`/sessions/${sessionId}`, { method: 'DELETE' });
  }

  async healthCheck(): Promise<{ status: string }> {
    return this.request('/auth/health');
  }
}
