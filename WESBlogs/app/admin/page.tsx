import { getAdminSession } from '@/lib/admin/auth';
import Link from 'next/link';
import AdminConsole from './AdminConsole';

export const dynamic = 'force-dynamic';

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getAdminSession();
  const query = await searchParams;
  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-20 text-slate-100">
        <section className="w-full max-w-md rounded-[2rem] border border-white/15 bg-slate-950/75 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-8">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.35em] text-indigo-300">Owner Admin Console</p>
            <h1 className="text-3xl font-black">欢迎回来，wes</h1>
            <p className="mt-3 leading-7 text-slate-400">使用已绑定的 GitHub Owner 账号登录。管理台不会把 GitHub Token 发送到浏览器。</p>
          </div>
          {query.error && <p className="mb-5 rounded-2xl border border-rose-400/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{query.error}</p>}
          <a href="/api/admin/auth/login" className="block rounded-2xl bg-indigo-500 px-5 py-4 text-center font-bold text-white transition hover:bg-indigo-400">使用 GitHub Owner 登录</a>
          <Link href="/" className="mt-5 block text-center text-sm text-slate-400 transition hover:text-white">返回网站首页</Link>
        </section>
      </main>
    );
  }
  return <AdminConsole session={session} />;
}
