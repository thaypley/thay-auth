import { Router, Request, Response } from 'express';
import { createClient, getAdminPb } from '../providers/pocketbase.js';
import { createUserDirect } from '../providers/directSqlUsers.js';
import { requireUser } from '../middleware/requireAuth.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  validateEmail, validatePassword, validateUsername,
  validateBirthday, validateAccountType, validateInviteCode,
  sanitizeUsername,
} from '../utils/validate.js';

const VALID_CHARACTERISTIC_KEYS = ['bio', 'pronouns', 'astral_sign'];
const PRONOUN_VALUES = ['they/them', 'she/her', 'he/him', 'xe/xem', 'ze/zir', 'any', 'ask'];
const ASTRAL_SIGN_VALUES = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces', 'unknown'];

const router = Router();

// PB throws 404 "Missing collection context" when a collection doesn't
// exist on the target instance. Read paths treat that as "no rows" so a
// missing side-collection can't 500 core pages.
async function safeList(
  pb: Awaited<ReturnType<typeof getAdminPb>>,
  collection: string,
  page: number,
  perPage: number,
  options: Record<string, unknown>,
): Promise<{ items: unknown[] }> {
  try {
    return await pb.collection(collection).getList(page, perPage, options);
  } catch (err) {
    if ((err as { status?: number })?.status === 404) {
      logger.warn(`collection "${collection}" missing on PB instance — returning empty list`);
      return { items: [] };
    }
    throw err;
  }
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function avatarUrl(record: Record<string, unknown>): string {
  const filename = record.avatar as string;
  if (!filename) return '';
  // Already a full URL (legacy rows on the shared users collection)
  if (/^https?:\/\//.test(filename)) return filename;
  return `${config.pbPublicUrl}/api/files/users/${record.id}/${filename}`;
}

function sanitizeUser(record: Record<string, unknown>) {
  return {
    id: record.id,
    email: record.email,
    username: record.username,
    accountType: record.accountType,
    isVerified: record.isVerified || false,
    isArchitect: record.isArchitect || false,
    tier: record.tier || 'free',
    avatar: avatarUrl(record),
    birthday: record.birthday || '',
    created: record.created,
    updated: record.updated,
  };
}

// ─── Invite ────────────────────────────────────────────────────────

router.post('/check-invite', async (req: Request, res: Response) => {
  try {
    const { code } = req.body || req.query;
    const err = validateInviteCode(code);
    if (err) return res.status(200).json({ valid: false, error: err });

    const pb = await getAdminPb();
    const invites = await pb.collection('signup_invites').getList(1, 1, {
      filter: `code="${code.toString().trim().toUpperCase()}"`,
    });

    if (invites.items.length === 0) {
      return res.status(200).json({ valid: false, error: 'Invalid invite code' });
    }

    const invite = invites.items[0] as unknown as Record<string, unknown>;
    const maxUses = (invite.maxUses as number) || 1;
    const useCount = (invite.useCount as number) || 0;
    const expiresAt = invite.expiresAt ? new Date(invite.expiresAt as string) : null;

    if (expiresAt && expiresAt < new Date()) {
      return res.status(200).json({ valid: false, error: 'Invite code has expired' });
    }
    if (useCount >= maxUses) {
      return res.status(200).json({ valid: false, error: 'Invite code has been fully used' });
    }

    return res.status(200).json({ valid: true });
  } catch (err) {
    logger.error('check-invite error:', err);
    return res.status(500).json({ valid: false, error: 'Internal error' });
  }
});

// ─── Waitlist ──────────────────────────────────────────────────────

router.post('/waitlist', async (req: Request, res: Response) => {
  try {
    const { email, note, source } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const pb = await getAdminPb();
    const record = await pb.collection('signup_waitlist').create({
      email: email.toLowerCase().trim(),
      note: note || '',
      source: source || 'homebase',
    });

    return res.status(201).json({ success: true, id: record.id, message: 'You have been added to the waitlist.' });
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || 'Failed to join waitlist';
    if (msg.includes('unique') || msg.includes('already')) {
      return res.status(200).json({ success: true, message: 'This email is already on the waitlist.' });
    }
    logger.error('waitlist error:', err);
    return res.status(500).json({ error: 'Failed to join waitlist' });
  }
});

// ─── Signup ────────────────────────────────────────────────────────

router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, username, accountType, birthday, inviteCode } = req.body;

    const errors: string[] = [];
    const e1 = validateEmail(email);
    const e2 = validatePassword(password);
    const e3 = validateUsername(username);
    const e4 = validateAccountType(accountType);
    const e5 = validateBirthday(birthday);
    const e6 = validateInviteCode(inviteCode);
    if (e1) errors.push(e1);
    if (e2) errors.push(e2);
    if (e3) errors.push(e3);
    if (e4) errors.push(e4);
    if (e5) errors.push(e5);
    if (e6) errors.push(e6);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const pb = await getAdminPb();
    const code = inviteCode.toString().trim().toUpperCase();
    const invites = await pb.collection('signup_invites').getList(1, 1, {
      filter: `code="${code}"`,
    });
    if (invites.items.length === 0) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }
    const invite = invites.items[0] as unknown as Record<string, unknown>;
    const maxUses = (invite.maxUses as number) || 1;
    const useCount = (invite.useCount as number) || 0;
    if (useCount >= maxUses) {
      return res.status(400).json({ error: 'Invite code has been fully used' });
    }

    const sanitizedUsername = sanitizeUsername(username);
    const normalizedEmail = email.toLowerCase().trim();
    const birthDate = new Date(birthday);
    let age = new Date().getFullYear() - birthDate.getFullYear();
    const monthDiff = new Date().getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && new Date().getDate() < birthDate.getDate())) age--;

    let userId: string;
    if (config.directSqlUsers) {
      const created = await createUserDirect(config.pbDataPath, {
        email: normalizedEmail,
        password,
        username: sanitizedUsername,
        accountType,
        birthday,
        age,
        isVerified: false,
        tier: 'free',
      });
      userId = created.id;
    } else {
      const created = await pb.collection('users').create({
        email: normalizedEmail,
        password,
        passwordConfirm: password,
        username: sanitizedUsername,
        accountType,
        birthday: birthday,
        age,
        isVerified: false,
        tier: 'free',
      });
      userId = (created as unknown as Record<string, string>).id;
    }

    try {
      await pb.collection('signup_invites').update(invite.id as string, {
        useCount: useCount + 1,
        used: useCount + 1 >= maxUses,
        usedBy: userId,
        usedAt: new Date().toISOString(),
      });
    } catch (redeemErr) {
      logger.warn('Failed to redeem invite:', redeemErr);
    }

    const userPb = createClient();
    const authData = await userPb.collection('users').authWithPassword(normalizedEmail, password);

    logger.info(`User signed up: ${userId} (${sanitizedUsername})${config.directSqlUsers ? ' [direct-sql]' : ''}`);

    return res.status(201).json({
      user: sanitizeUser(authData.record as unknown as Record<string, unknown>),
      token: authData.token,
    });
  } catch (err: unknown) {
    logger.error('signup error:', err);
    const msg = (err as { message?: string; data?: { message?: string } })?.data?.message || (err as Error)?.message || 'Signup failed';
    return res.status(400).json({ error: msg });
  }
});

// ─── Login ─────────────────────────────────────────────────────────

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { identity, password } = req.body;
    if (!identity || !password) {
      return res.status(400).json({ error: 'identity and password are required' });
    }

    // PB's identityFields only include email; resolve usernames ourselves.
    let loginIdentity = identity.toLowerCase().trim();
    if (!loginIdentity.includes('@') && /^[a-z0-9_]{3,20}$/.test(loginIdentity)) {
      try {
        const adminPb = await getAdminPb();
        const match = await adminPb.collection('users').getList(1, 1, {
          filter: `username="${loginIdentity}"`,
        });
        if (match.items.length > 0) {
          loginIdentity = (match.items[0] as unknown as Record<string, string>).email;
        }
      } catch { /* fall through to authWithPassword with the raw identity */ }
    }

    const pb = createClient();
    const authData = await pb.collection('users').authWithPassword(loginIdentity, password);

    const record = authData.record as unknown as Record<string, unknown>;
    if (!record.isVerified) {
      // Password already matched — hand back the token so the client can
      // complete verification (/send-verification + /verify-email) without
      // being locked out of the flow entirely.
      return res.status(403).json({
        error: 'Email not verified',
        code: 'EMAIL_NOT_VERIFIED',
        token: authData.token,
        user: sanitizeUser(record),
      });
    }

    logger.info(`User logged in: ${authData.record.id} (${record.username})`);

    return res.status(200).json({
      user: sanitizeUser(authData.record as unknown as Record<string, unknown>),
      token: authData.token,
      expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
  } catch (err) {
    logger.warn('login failed:', err);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
});

// ─── Session Management ────────────────────────────────────────────

router.post('/logout', requireUser, async (req: Request, res: Response) => {
  try {
    logger.info(`User logged out: ${req.user!.id}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const user = await pb.collection('users').getOne(req.user!.id);
    return res.status(200).json(sanitizeUser(user as unknown as Record<string, unknown>));
  } catch (err) {
    logger.error('/me error:', err);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.post('/refresh', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = createClient();
    pb.authStore.save(req.headers.authorization!.slice(7), null);
    const authData = await pb.collection('users').authRefresh();
    return res.status(200).json({
      token: authData.token,
      user: sanitizeUser(authData.record as unknown as Record<string, unknown>),
    });
  } catch (err) {
    return res.status(401).json({ error: 'Token refresh failed' });
  }
});

// ─── Email Verification ────────────────────────────────────────────

router.post('/send-verification', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const user = req.user!;
    const code = generateCode();
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await pb.collection('users').update(user.id, {
      emailVerificationCode: code,
      emailVerificationCodeExpiry: expiry,
    });

    const { sendEmail, verificationEmailTemplate } = await import('../utils/email.js');
    await sendEmail(user.email, 'Verify your email', verificationEmailTemplate(code));

    return res.status(200).json({ success: true, message: 'Verification code sent' });
  } catch (err) {
    logger.error('send-verification error:', err);
    return res.status(500).json({ error: 'Failed to send verification' });
  }
});

router.post('/verify-email', requireUser, async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Verification code required' });

    const pb = await getAdminPb();
    const user = await pb.collection('users').getOne(req.user!.id);

    const storedCode = (user as unknown as Record<string, unknown>).emailVerificationCode as string;
    const expiry = (user as unknown as Record<string, unknown>).emailVerificationCodeExpiry as string;

    if (!storedCode || storedCode !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    if (expiry && new Date(expiry) < new Date()) {
      return res.status(400).json({ error: 'Verification code has expired' });
    }

    await pb.collection('users').update(req.user!.id, {
      isVerified: true,
      emailVerified: true,
      emailVerificationCode: '',
      emailVerificationCodeExpiry: '',
    });

    return res.status(200).json({ success: true, message: 'Email verified' });
  } catch (err) {
    logger.error('verify-email error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// ─── Username Change ───────────────────────────────────────────────

const USERNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

router.post('/change-username', requireUser, async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    const err = validateUsername(username);
    if (err) return res.status(400).json({ error: err });

    const pb = await getAdminPb();
    const user = await pb.collection('users').getOne(req.user!.id);
    const lastChange = (user as unknown as Record<string, unknown>).lastUsernameChangeAt as string;

    if (lastChange) {
      const elapsed = Date.now() - new Date(lastChange).getTime();
      if (elapsed < USERNAME_COOLDOWN_MS) {
        const daysLeft = Math.ceil((USERNAME_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
        return res.status(429).json({ error: `Username can be changed again in ${daysLeft} day(s)` });
      }
    }

    const sanitizedUsername = sanitizeUsername(username);
    const updated = await pb.collection('users').update(req.user!.id, {
      username: sanitizedUsername,
      lastUsernameChangeAt: new Date().toISOString(),
    });

    return res.status(200).json({ user: sanitizeUser(updated as unknown as Record<string, unknown>) });
  } catch (err: unknown) {
    logger.error('change-username error:', err);
    const msg = (err as { data?: { message?: string } })?.data?.message || 'Failed to change username';
    return res.status(400).json({ error: msg });
  }
});

// ─── Avatar Upload ─────────────────────────────────────────────────

const AVATAR_MIME_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

router.post('/avatar', requireUser, async (req: Request, res: Response) => {
  try {
    const { data, contentType } = req.body || {};
    if (typeof data !== 'string' || !data) {
      return res.status(400).json({ error: 'data (base64 image) is required' });
    }
    const ext = AVATAR_MIME_TYPES[contentType];
    if (!ext) {
      return res.status(400).json({ error: `contentType must be one of: ${Object.keys(AVATAR_MIME_TYPES).join(', ')}` });
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid base64 data' });
    }
    if (bytes.length === 0) return res.status(400).json({ error: 'Empty image' });
    if (bytes.length > AVATAR_MAX_BYTES) {
      return res.status(400).json({ error: 'Avatar must be 4MB or smaller' });
    }

    const pb = await getAdminPb();
    const form = new FormData();
    form.append('avatar', new Blob([new Uint8Array(bytes)], { type: contentType }), `avatar.${ext}`);
    const updated = await pb.collection('users').update(req.user!.id, form);

    return res.status(200).json({ user: sanitizeUser(updated as unknown as Record<string, unknown>) });
  } catch (err: unknown) {
    logger.error('avatar upload error:', err);
    const msg = (err as { data?: { message?: string } })?.data?.message || 'Failed to upload avatar';
    return res.status(400).json({ error: msg });
  }
});

router.delete('/avatar', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const updated = await pb.collection('users').update(req.user!.id, { avatar: null });
    return res.status(200).json({ user: sanitizeUser(updated as unknown as Record<string, unknown>) });
  } catch (err) {
    logger.error('avatar delete error:', err);
    return res.status(400).json({ error: 'Failed to remove avatar' });
  }
});

// ─── Check Username Availability ────────────────────────────────────

router.get('/check-username', async (req: Request, res: Response) => {
  try {
    const username = req.query.username as string;
    if (!username) return res.status(400).json({ error: 'username query param required' });
    const err = validateUsername(username);
    if (err) return res.status(200).json({ available: false, error: err });

    const pb = await getAdminPb();
    const result = await pb.collection('users').getList(1, 1, {
      filter: `username="${sanitizeUsername(username)}"`,
    });
    return res.status(200).json({ available: result.items.length === 0 });
  } catch (err) {
    logger.error('check-username error:', err);
    return res.status(500).json({ error: 'Failed to check username' });
  }
});

// ─── Password Reset ────────────────────────────────────────────────

router.post('/request-password-reset', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const pb = createClient();
    await pb.collection('users').requestPasswordReset(email.toLowerCase().trim());

    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent',
    });
  } catch (err) {
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent',
    });
  }
});

// ─── Profile (full user + characteristics) ──────────────────────────

router.get('/profile', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const user = await pb.collection('users').getOne(req.user!.id);
    const chars = await safeList(pb, 'user_characteristics', 1, 100, {
      filter: `userId="${req.user!.id}"`,
    });

    const characteristics: Record<string, string> = {};
    for (const c of chars.items) {
      const rec = c as unknown as Record<string, string>;
      characteristics[rec.key] = rec.value;
    }

    return res.status(200).json({
      ...sanitizeUser(user as unknown as Record<string, unknown>),
      characteristics,
    });
  } catch (err) {
    logger.error('/profile GET error:', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.patch('/profile', requireUser, async (req: Request, res: Response) => {
  try {
    const { characteristics } = req.body;
    const pb = await getAdminPb();
    const userId = req.user!.id;

    // Upsert characteristics
    if (characteristics && typeof characteristics === 'object') {
      for (const [key, value] of Object.entries(characteristics)) {
        if (!VALID_CHARACTERISTIC_KEYS.includes(key)) continue;
        const strVal = String(value).trim();

        // Validation
        if (key === 'pronouns' && strVal && !PRONOUN_VALUES.includes(strVal)) {
          return res.status(400).json({ error: `Invalid pronoun value. Valid: ${PRONOUN_VALUES.join(', ')}` });
        }
        if (key === 'astral_sign' && strVal && !ASTRAL_SIGN_VALUES.includes(strVal.toLowerCase())) {
          return res.status(400).json({ error: `Invalid astral sign. Valid: ${ASTRAL_SIGN_VALUES.join(', ')}` });
        }
        if (key === 'bio' && strVal.length > 280) {
          return res.status(400).json({ error: 'Bio must be 280 characters or fewer' });
        }

        const existing = await pb.collection('user_characteristics').getList(1, 1, {
          filter: `userId="${userId}" && key="${key}"`,
        });

        if (existing.items.length > 0) {
          await pb.collection('user_characteristics').update(existing.items[0].id, {
            value: strVal,
          });
        } else {
          await pb.collection('user_characteristics').create({
            userId,
            key,
            value: strVal,
            visibility: 'public',
          });
        }
      }
    }

    // Fetch updated profile
    const user = await pb.collection('users').getOne(userId);
    const chars = await safeList(pb, 'user_characteristics', 1, 100, {
      filter: `userId="${userId}"`,
    });
    const charMap: Record<string, string> = {};
    for (const c of chars.items) {
      const rec = c as unknown as Record<string, string>;
      charMap[rec.key] = rec.value;
    }

    return res.status(200).json({
      ...sanitizeUser(user as unknown as Record<string, unknown>),
      characteristics: charMap,
    });
  } catch (err) {
    logger.error('/profile PATCH error:', err);
    const msg = (err as { data?: { message?: string } })?.data?.message || 'Failed to update profile';
    return res.status(400).json({ error: msg });
  }
});

// ─── Characteristics CRUD ──────────────────────────────────────────

router.get('/profile/characteristics', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const chars = await safeList(pb, 'user_characteristics', 1, 100, {
      filter: `userId="${req.user!.id}"`,
    });
    const map: Record<string, string> = {};
    for (const c of chars.items) {
      const rec = c as unknown as Record<string, string>;
      map[rec.key] = rec.value;
    }
    return res.status(200).json({ characteristics: map });
  } catch (err) {
    logger.error('/profile/characteristics GET error:', err);
    return res.status(500).json({ error: 'Failed to fetch characteristics' });
  }
});

router.put('/profile/characteristics', requireUser, async (req: Request, res: Response) => {
  try {
    const { characteristics } = req.body;
    if (!characteristics || typeof characteristics !== 'object') {
      return res.status(400).json({ error: 'characteristics object required' });
    }

    const pb = await getAdminPb();
    const userId = req.user!.id;

    // Delete existing
    const existing = await pb.collection('user_characteristics').getList(1, 200, {
      filter: `userId="${userId}"`,
    });
    for (const c of existing.items) {
      await pb.collection('user_characteristics').delete(c.id);
    }

    // Insert new
    for (const [key, value] of Object.entries(characteristics)) {
      if (!VALID_CHARACTERISTIC_KEYS.includes(key)) continue;
      const strVal = String(value).trim();
      if (!strVal) continue;

      if (key === 'pronouns' && !PRONOUN_VALUES.includes(strVal)) continue;
      if (key === 'astral_sign' && !ASTRAL_SIGN_VALUES.includes(strVal.toLowerCase())) continue;
      if (key === 'bio' && strVal.length > 280) continue;

      await pb.collection('user_characteristics').create({
        userId,
        key,
        value: strVal,
        visibility: 'public',
      });
    }

    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(characteristics)) {
      if (VALID_CHARACTERISTIC_KEYS.includes(key)) {
        map[key] = String(value).trim();
      }
    }

    return res.status(200).json({ characteristics: map });
  } catch (err) {
    logger.error('/profile/characteristics PUT error:', err);
    return res.status(500).json({ error: 'Failed to update characteristics' });
  }
});

// ─── Apps Management ───────────────────────────────────────────────

router.get('/apps', requireUser, async (req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const apps = await safeList(pb, 'user_apps', 1, 100, {
      filter: `userId="${req.user!.id}"`,
      sort: '-installedAt',
    });
    return res.status(200).json({
      apps: apps.items.map((a: unknown) => {
        const rec = a as Record<string, unknown>;
        return {
          id: rec.id,
          appId: rec.appId,
          appName: rec.appName,
          installedVersion: rec.installedVersion,
          latestVersion: rec.latestVersion,
          autoUpdate: rec.autoUpdate,
          status: rec.status || 'installed',
          installedAt: rec.installedAt,
          lastUpdatedAt: rec.lastUpdatedAt,
        };
      }),
    });
  } catch (err) {
    logger.error('/apps GET error:', err);
    return res.status(500).json({ error: 'Failed to fetch apps' });
  }
});

router.post('/apps', requireUser, async (req: Request, res: Response) => {
  try {
    const { appId, appName, installedVersion, autoUpdate } = req.body;
    if (!appId) return res.status(400).json({ error: 'appId is required' });

    const pb = await getAdminPb();
    const existing = await pb.collection('user_apps').getList(1, 1, {
      filter: `userId="${req.user!.id}" && appId="${appId}"`,
    });

    if (existing.items.length > 0) {
      const updated = await pb.collection('user_apps').update(existing.items[0].id, {
        installedVersion: installedVersion || existing.items[0].installedVersion,
        appName: appName || existing.items[0].appName,
        autoUpdate: autoUpdate !== undefined ? autoUpdate : existing.items[0].autoUpdate,
        lastUpdatedAt: new Date().toISOString(),
        status: 'installed',
      });
      return res.status(200).json({ app: updated });
    }

    const created = await pb.collection('user_apps').create({
      userId: req.user!.id,
      appId,
      appName: appName || appId,
      installedVersion: installedVersion || '1.0.0',
      autoUpdate: autoUpdate !== undefined ? autoUpdate : true,
      installedAt: new Date().toISOString(),
      status: 'installed',
    });

    return res.status(201).json({ app: created });
  } catch (err) {
    logger.error('/apps POST error:', err);
    return res.status(400).json({ error: 'Failed to register app' });
  }
});

router.delete('/apps/:appId', requireUser, async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const pb = await getAdminPb();
    const existing = await pb.collection('user_apps').getList(1, 1, {
      filter: `userId="${req.user!.id}" && appId="${appId}"`,
    });

    if (existing.items.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }

    await pb.collection('user_apps').update(existing.items[0].id, {
      status: 'uninstalled',
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('/apps DELETE error:', err);
    return res.status(500).json({ error: 'Failed to uninstall app' });
  }
});

// ─── Health ────────────────────────────────────────────────────────

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const pb = await getAdminPb();
    const health = await pb.health.check();
    return res.status(200).json({
      status: 'ok',
      pocketbase: health,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      pocketbase: 'unreachable',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;