export class ThayAuth {
    baseUrl;
    token = null;
    user = null;
    listeners = new Set();
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    }
    getToken() {
        return this.token;
    }
    getUser() {
        return this.user;
    }
    onAuthStateChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    notify(user) {
        for (const listener of this.listeners) {
            try {
                listener(user);
            }
            catch { /* ignore */ }
        }
    }
    async request(path, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
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
        return data;
    }
    async login(identity, password) {
        const data = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ identity, password }),
        });
        this.token = data.token;
        this.user = data.user;
        this.notify(this.user);
        return data;
    }
    async signup(data) {
        const result = await this.request('/auth/signup', {
            method: 'POST',
            body: JSON.stringify(data),
        });
        this.token = result.token;
        this.user = result.user;
        this.notify(this.user);
        return result;
    }
    async logout() {
        try {
            await this.request('/auth/logout', { method: 'POST' });
        }
        catch { /* ignore */ }
        this.token = null;
        this.user = null;
        this.notify(null);
    }
    async refreshSession() {
        const data = await this.request('/auth/refresh', {
            method: 'POST',
        });
        this.token = data.token;
        this.user = data.user;
        return data;
    }
    async getMe() {
        return this.request('/auth/me');
    }
    async sendVerificationEmail() {
        await this.request('/auth/send-verification', { method: 'POST' });
    }
    async verifyEmail(code) {
        await this.request('/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ code }),
        });
    }
    async requestPasswordReset(email) {
        await this.request('/auth/request-password-reset', {
            method: 'POST',
            body: JSON.stringify({ email }),
        });
    }
    async checkInviteCode(code) {
        return this.request('/auth/check-invite', {
            method: 'POST',
            body: JSON.stringify({ code }),
        });
    }
    async pairDevice(label, scopes) {
        return this.request('/devices/pair', {
            method: 'POST',
            body: JSON.stringify({ label, scopes }),
        });
    }
    async unpairDevice(deviceToken) {
        await this.request('/devices/unpair', {
            method: 'DELETE',
            body: JSON.stringify({ deviceToken }),
        });
    }
    async listDevices() {
        const data = await this.request('/devices');
        return data.devices;
    }
    async verifyDeviceToken(deviceToken) {
        return this.request('/devices/verify', {
            method: 'POST',
            body: JSON.stringify({ deviceToken }),
        });
    }
    async listSessions() {
        const data = await this.request('/sessions');
        return data.sessions;
    }
    async revokeSession(sessionId) {
        await this.request(`/sessions/${sessionId}`, { method: 'DELETE' });
    }
    async healthCheck() {
        return this.request('/auth/health');
    }
}
