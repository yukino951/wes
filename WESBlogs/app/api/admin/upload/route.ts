import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { GitHubContentError, putBinaryContentFile } from '@/lib/admin/github';

export const runtime = 'nodejs';

const APP_ROOT = 'WESBlogs';
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function safeAlbumId(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(value)) {
    throw new GitHubContentError('相册 ID 格式无效', 400, 'invalid_album_id');
  }
  return value;
}

function hasImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}

function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof GitHubContentError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error('[admin] photo upload error', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: '图片上传失败' }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const formData = await request.formData();
    const upload = formData.get('file');
    const albumId = safeAlbumId(String(formData.get('albumId') || ''));

    if (!(upload instanceof File)) {
      throw new GitHubContentError('请选择要上传的图片', 400, 'missing_file');
    }
    const extension = MIME_EXTENSIONS[upload.type];
    if (!extension) {
      throw new GitHubContentError('仅支持 JPG、PNG 和 WebP 图片', 415, 'unsupported_image_type');
    }
    if (upload.size <= 0 || upload.size > MAX_UPLOAD_BYTES) {
      throw new GitHubContentError('处理后的图片不能超过 3 MB', 413, 'image_too_large');
    }

    const bytes = new Uint8Array(await upload.arrayBuffer());
    if (!hasImageSignature(bytes, upload.type)) {
      throw new GitHubContentError('文件内容不是有效图片', 400, 'invalid_image');
    }

    // Stable paths make retries safe even if the first response was lost.
    const filename = `${crypto.createHash('sha256').update(bytes).digest('hex')}.${extension}`;
    const relativePath = `uploads/photos/${albumId}/${filename}`;
    const repositoryPath = `${APP_ROOT}/public/${relativePath}`;
    const result = await putBinaryContentFile(
      repositoryPath,
      bytes,
      `content: upload photo for album ${albumId}`,
    );

    return NextResponse.json({
      ...result,
      path: repositoryPath,
      url: `/${relativePath}`,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
