import { Router, Request, Response } from 'express';
import { createClient, getAdminPb } from '../providers/pocketbase.js';
import { requireUser } from '../middleware/requireAuth.js';
import { logger } from '../utils/logger.js';
import {
  validateEmail, validatePassword, validateUsername,
  validateBirthday, validateAccountType, validateInviteCode,
  sanitizeUsername,
} from '../utils/validate.js';

const router = Router();

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

function sanitizeUser(record: Record<string, unknown>) {
  return {
    id: record.id,
    email: record.email,
    username: record.username,
    accountType: record.accountType,
    isVerified: record.isVerified || false,
    isArchitect: record.isArchitect || false,
    tier: record.tier || 'free',
    avatar: record.avatar || '',
    created: record.created,
    updated: record.updated,
  };
}

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

    const user = await pb.collection('users').create({
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

    try {
      await pb.collection('signup_invites').update(invite.id as string, {
        useCount: useCount + 1,
        used: useCount + 1 >= maxUses,
        usedBy: user.id,
        usedAt: new Date().toISOString(),
      });
    } catch (redeemErr) {
      logger.warn('Failed to redeem invite:', redeemErr);
    }

    const userPb = createClient();
    const authData = await userPb.collection('users').authWithPassword(normalizedEmail, password);

    logger.info(`User signed up: ${user.id} (${sanitizedUsername})`);

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

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { identity, password } = req.body;
    if (!identity || !password) {
      return res.status(400).json({ error: 'identity and password are required' });
    }

    const pb = createClient();
    const authData = await pb.collection('users').authWithPassword(
      identity.toLowerCase().trim(),
      password,
    );

    const record = authData.record as unknown as Record<string, unknown>;
    if (!record.isVerified) {
      return res.status(403).json({ error: 'Email not verified', code: 'EMAIL_NOT_VERIFIED' });
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
