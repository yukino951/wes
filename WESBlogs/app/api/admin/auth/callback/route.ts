import { NextResponse } from 'next/server';
import { consumeOAuthState, getAdminLogin, setAdminSession } from '@/lib/admin/auth';
import { exchangeGitHubCode, getGitHubUser } from '@/lib/admin/github';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (error) return NextResponse.redirect(new URL(`/admin?error=${encodeURIComponent(error)}`, url.origin));
  const returnTo = await consumeOAuthState(state);
  if (!code || !returnTo) {
    return NextResponse.redirect(new URL(`/admin?error=${encodeURIComponent('登录校验已过期，请从网站内重新发起登录。')}`, url.origin));
  }
  try {
    const token = await exchangeGitHubCode(code);
    const user = await getGitHubUser(token);
    if (user.login.toLowerCase() !== getAdminLogin().toLowerCase()) return NextResponse.json({ error: '该 GitHub 账号没有 Owner 权限' }, { status: 403 });
    await setAdminSession({ login: user.login, name: user.name || undefined, avatarUrl: user.avatar_url });
    return NextResponse.redirect(new URL(returnTo, url.origin));
  } catch (error) {
    const message = error instanceof Error ? error.message : '登录失败';
    return NextResponse.redirect(new URL(`/admin?error=${encodeURIComponent(message)}`, url.origin));
  }
}
