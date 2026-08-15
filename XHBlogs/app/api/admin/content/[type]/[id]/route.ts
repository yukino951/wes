import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { assertContentType, deleteArrayItem, deleteMarkdown, saveArrayItem, saveMarkdown } from '@/lib/admin/content';
import { GitHubContentError } from '@/lib/admin/github';

export const runtime = 'nodejs';

function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof GitHubContentError) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
  console.error('[admin] item route error', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: '管理台请求失败' }, { status: 500 });
}

async function getInput(context: { params: Promise<{ type: string; id: string }> }) {
  const params = await context.params;
  assertContentType(params.type);
  return { ...params, id: decodeURIComponent(params.id) };
}

export async function PUT(request: Request, context: { params: Promise<{ type: string; id: string }> }) {
  try {
    await requireAdmin();
    const { type, id } = await getInput(context);
    const body = await request.json();
    const value = { ...(body.value || {}), id };
    const message = String(body.message || `content: update ${type}/${id}`);
    if (type === 'moments' || type === 'posts' || type === 'chatters') return NextResponse.json(await saveMarkdown(type, value, body.baseSha, message));
    if (type === 'albums' || type === 'projects' || type === 'friends') return NextResponse.json(await saveArrayItem(type, value, body.baseSha, message));
    return NextResponse.json({ error: '该类型不支持逐项更新' }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ type: string; id: string }> }) {
  try {
    await requireAdmin();
    const { type, id } = await getInput(context);
    const body = await request.json().catch(() => ({}));
    const message = String(body.message || `content: delete ${type}/${id}`);
    if (!body.baseSha) throw new GitHubContentError('删除操作需要当前文件 SHA', 400, 'missing_sha');
    if (type === 'moments' || type === 'posts' || type === 'chatters') return NextResponse.json(await deleteMarkdown(type, id, body.baseSha, message));
    if (type === 'albums' || type === 'projects' || type === 'friends') return NextResponse.json(await deleteArrayItem(type, id, body.baseSha, message));
    return NextResponse.json({ error: '该类型不支持删除' }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
