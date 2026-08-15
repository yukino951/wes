import { NextResponse } from 'next/server';
import { createOAuthState, getAdminCallbackUrl } from '@/lib/admin/auth';

export const runtime = 'nodejs';

export async function GET() {
  const clientId = process.env.ADMIN_GITHUB_CLIENT_ID;
  const callbackUrl = getAdminCallbackUrl();
  if (!clientId || !callbackUrl) return NextResponse.json({ error: 'Admin GitHub OAuth 尚未配置' }, { status: 503 });
  const state = await createOAuthState();
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  return NextResponse.redirect(url);
}
