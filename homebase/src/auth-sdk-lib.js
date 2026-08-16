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
    setToken(token) {
        this.token = token || null;
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
        let data = {};
        // A 5xx from the edge (nginx/Cloudflare) is often HTML, not JSON.
        // res.json() would throw a SyntaxError BEFORE we attach .status, turning
        // a recoverable 503 into an opaque "Failed to fetch" with no code.
        try {
            data = await res.json();
        }
        catch {
            data = {};
        }
        if (!res.ok) {
            const err = new Error(data.error || `Request failed: ${res.status}`);
            err.status = res.status;
            err.code = data.code;
            err.retryAfter = data.retryAfter;
            err.data = data;
            throw err;
        }
        return data;
    }
    async login(identity, password, app = 'homebase') {
        const data = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ identity, password, app }),
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
    async confirmPasswordReset(token, password, passwordConfirm) {
        return this.request('/auth/confirm-password-reset', {
            method: 'POST',
            body: JSON.stringify({ token, password, passwordConfirm }),
        });
    }
    async joinWaitlist(email, note) {
        return this.request('/auth/waitlist', {
            method: 'POST',
            body: JSON.stringify({ email, note }),
        });
    }
    async getCatalog() {
        const data = await this.request('/auth/catalog');
        return data.apps;
    }
    async getPlatforms() {
        const data = await this.request('/auth/platforms');
        return data.platforms;
    }
    async listInvites() {
        const data = await this.request('/auth/invites');
        return data.invites;
    }
    async createInvite(options = {}) {
        const data = await this.request('/auth/invites', {
            method: 'POST',
            body: JSON.stringify(options),
        });
        return data.invite;
    }
    async deleteInvite(id) {
        await this.request(`/auth/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
    async revokeDevice(deviceId) {
        await this.request(`/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
    }
    async healthCheck() {
        return this.request('/auth/health');
    }
    /**
     * Ambient weather via the server-side Open-Meteo proxy. The browser
     * never talks to a third-party host directly, so ad-blockers/content
     * blockers in desktop webviews cannot kill the request with
     * ERR_BLOCKED_BY_CLIENT.
     */
    async getWeather(lat, lon) {
        return this.request(`/auth/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    }
    async getProfile() {
        return this.request('/auth/profile');
    }
    async updateProfile(update) {
        return this.request('/auth/profile', {
            method: 'PATCH',
            body: JSON.stringify(update),
        });
    }
    async setCharacteristics(characteristics) {
        return this.request('/auth/profile/characteristics', {
            method: 'PUT',
            body: JSON.stringify({ characteristics }),
        });
    }
    async changeUsername(username) {
        return this.request('/auth/change-username', {
            method: 'POST',
            body: JSON.stringify({ username }),
        });
    }
    async checkUsername(username) {
        return this.request(`/auth/check-username?username=${encodeURIComponent(username)}`);
    }
    async uploadAvatar(file) {
        const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read file'));
            reader.readAsDataURL(file);
        });
        return this.request('/auth/avatar', {
            method: 'POST',
            body: JSON.stringify({ data, contentType: file.type }),
        });
    }
    async removeAvatar() {
        return this.request('/auth/avatar', { method: 'DELETE' });
    }
    async getApps() {
        const data = await this.request('/auth/apps');
        return data.apps;
    }
    async getSubscription() {
        return this.request('/auth/subscription');
    }
    /** Create a checkout session for upgrading tiers (Stripe or mock). */
    async createCheckout(tier) {
        return this.request('/auth/subscription/checkout', {
            method: 'POST',
            body: JSON.stringify({ tier }),
        });
    }
    /** Open the billing portal (cancel / update payment method). */
    async openBillingPortal() {
        return this.request('/auth/subscription/portal', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }
    async cancelSubscription() {
        return this.request('/auth/subscription/cancel', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }
    /** Best-effort relay of the current session to a sibling thaypley subdomain. */
    async relayPlatform() {
        const res = await fetch(`${this.baseUrl}/auth/relay`, {
            method: 'POST',
            headers: this.token ? { 'Authorization': `Bearer ${this.token}` } : {},
            credentials: 'include',
        });
        if (!res.ok) return false;
        return true;
    }
    /**
     * Consume the thay_auth_relay cookie (set by /auth/relay before the
     * account switcher navigates). Used by sibling subdomains at boot:
     * returns a fresh session for the local app + the raw pbToken for
     * legacy platforms that verify against PocketBase directly.
     */
    async consumeRelay(aud = 'homebase') {
        const res = await fetch(`${this.baseUrl}/auth/consume-relay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aud }),
            credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return null;
        return data;
    }
}
