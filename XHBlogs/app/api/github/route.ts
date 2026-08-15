import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'GitHub OAuth is not configured on the server.' },
        { status: 503 },
      );
    }

    // Gitalk sends { code, client_id, client_secret }. Never trust or forward
    // the browser-provided secret; use the Vercel server-side environment var.
    const body = (await req.json()) as { code?: string };
    if (!body.code) {
      return NextResponse.json({ error: 'Missing OAuth code.' }, { status: 400 });
    }

    const githubRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        code: body.code,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const data = await githubRes.json();
    return NextResponse.json(data, { status: githubRes.status });

  } catch (error) {
    console.error('代理请求失败:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
