import crypto from 'node:crypto';
import { cookies } from 'next/headers';

const SESSION_COOKIE = 'wes_admin_session';
const STATE_COOKIE = 'wes_admin_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const STATE_TTL_SECONDS = 60 * 10;

type Session = { login: string; name?: string; avatarUrl?: string; exp: number };

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET must be configured with at least 32 characters');
  }
  return secret;
}

function sign(value: string) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function encode<T>(payload: T) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decode<T>(token: string | undefined): T | null {
  if (!token) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function getAdminLogin() {
  return process.env.ADMIN_GITHUB_LOGIN || 'yukino951';
}

export function getAdminCallbackUrl() {
  return process.env.ADMIN_GITHUB_CALLBACK_URL || '';
}

export async function createOAuthState() {
  const nonce = crypto.randomBytes(32).toString('base64url');
  const store = await cookies();
  store.set(STATE_COOKIE, encode({ nonce, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_TTL_SECONDS,
    path: '/api/admin/auth',
  });
  return nonce;
}

export async function consumeOAuthState(value: string | null) {
  const store = await cookies();
  const saved = decode<{ nonce: string; exp: number }>(store.get(STATE_COOKIE)?.value);
  store.delete(STATE_COOKIE);
  return Boolean(value && saved && saved.nonce === value && saved.exp > Math.floor(Date.now() / 1000));
}

export async function setAdminSession(user: { login: string; name?: string; avatarUrl?: string }) {
  const store = await cookies();
  const session: Session = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  store.set(SESSION_COOKIE, encode(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  });
}

export async function clearAdminSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getAdminSession(): Promise<Session | null> {
  let session: Session | null = null;
  try {
    session = decode<Session>((await cookies()).get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
  if (!session || session.exp <= Math.floor(Date.now() / 1000) || session.login !== getAdminLogin()) return null;
  return session;
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) {
    throw new Response('Unauthorized', { status: 401 });
  }
  return session;
}
