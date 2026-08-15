import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { assertContentType, listContent, saveAbout, saveArrayItem, saveMarkdown, saveSingleton } from '@/lib/admin/content';
import { GitHubContentError } from '@/lib/admin/github';

export const runtime = 'nodejs';

function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof GitHubContentError) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
  console.error('[admin] content route error', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: '管理台请求失败' }, { status: 500 });
}

export async function GET(_request: Request, context: { params: Promise<{ type: string }> }) {
  try {
    await requireAdmin();
    const { type } = await context.params;
    assertContentType(type);
    return NextResponse.json(await listContent(type));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ type: string }> }) {
  try {
    await requireAdmin();
    const { type } = await context.params;
    assertContentType(type);
    const body = await request.json();
    const baseSha = body.baseSha || null;
    const message = String(body.message || `content: update ${type}`);
    if (type === 'profile' || type === 'site-settings') return NextResponse.json(await saveSingleton(type, body.value || {}, baseSha, message));
    if (type === 'about') return NextResponse.json(await saveAbout(body.value || {}, baseSha, message));
    if (type === 'moments' || type === 'posts' || type === 'chatters') return NextResponse.json(await saveMarkdown(type, body.value, baseSha, message));
    if (type === 'albums' || type === 'projects' || type === 'friends') return NextResponse.json(await saveArrayItem(type, body.value, baseSha, message));
    return NextResponse.json({ error: '不支持的写入类型' }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
