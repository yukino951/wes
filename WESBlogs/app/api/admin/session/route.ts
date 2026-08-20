import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/admin/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getAdminSession();
  return NextResponse.json(
    { authenticated: Boolean(session) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
