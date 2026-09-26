import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { albums } from '@/data/albums';

export const runtime = 'nodejs';

// Read the album bundled in this deployment, not the newer GitHub content.
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const id = new URL(request.url).searchParams.get('albumId');
    const album = albums.find((entry) => entry.id === id);
    return NextResponse.json({ urls: album?.photos.map((photo) => photo.url) || [] }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: '暂时无法确认发布状态' }, { status: 503 });
  }
}
