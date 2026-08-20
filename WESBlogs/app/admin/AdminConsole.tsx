'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type AdminSession = { login: string; name?: string; avatarUrl?: string; exp: number };
type ContentType = 'profile' | 'about' | 'moments' | 'posts' | 'chatters' | 'albums' | 'projects' | 'friends' | 'site-settings';
type RecordItem = { id: string; sha?: string; filename?: string; frontmatter?: Record<string, any>; content?: string; [key: string]: any };
type Envelope = { type: ContentType; sha: string | null; path: string | null; items: RecordItem[]; singleton?: any };

const tabs: Array<{ id: ContentType | 'dashboard'; label: string; group: string }> = [
  { id: 'dashboard', label: '仪表盘', group: '概览' },
  { id: 'profile', label: '个人资料', group: '站点' },
  { id: 'about', label: '关于页', group: '站点' },
  { id: 'site-settings', label: '站点设置', group: '站点' },
  { id: 'moments', label: '说说', group: '内容' },
  { id: 'posts', label: '文章', group: '内容' },
  { id: 'chatters', label: '杂谈', group: '内容' },
  { id: 'albums', label: '相册', group: '数据' },
  { id: 'projects', label: '项目', group: '数据' },
  { id: 'friends', label: '友链', group: '数据' },
];

const markdownTypes = new Set<ContentType>(['moments', 'posts', 'chatters']);
const arrayTypes = new Set<ContentType>(['albums', 'projects', 'friends']);

function prettyJson(value: any) { return JSON.stringify(value ?? {}, null, 2); }

function defaultItem(type: ContentType): RecordItem {
  const id = `${type}-${Date.now()}`;
  if (markdownTypes.has(type)) return { id, frontmatter: { id, title: type === 'moments' ? undefined : '新内容', date: new Date().toISOString() }, content: '' };
  if (type === 'albums') return { id, title: '新相册', description: '', cover: '', date: new Date().toISOString().slice(0, 7), photos: [] };
  if (type === 'projects') return { id, name: '新项目', description: '', icon: '🚀', githubUrl: '', tags: [] };
  return { id, name: '新友链', url: '', description: '', avatar: '', themeColor: 'rgba(99, 102, 241, 0.5)' };
}

function labelFor(type: ContentType) { return tabs.find((tab) => tab.id === type)?.label || type; }

export default function AdminConsole({ session }: { session: AdminSession }) {
  const [active, setActive] = useState<ContentType | 'dashboard'>('dashboard');
  const [data, setData] = useState<Envelope | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecordItem | null>(null);
  const [rawJson, setRawJson] = useState('');
  const [commitMessage, setCommitMessage] = useState('content: update from admin console');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(async (type: ContentType) => {
    setLoading(true); setNotice(null);
    try {
      const response = await fetch(`/api/admin/content/${type}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '加载失败');
      setData(body);
      if (body.items) setCounts((current) => ({ ...current, [type]: body.items.length }));
      if (body.singleton !== undefined) {
        setDraft(body.singleton); setRawJson(prettyJson(body.singleton)); setSelectedId(null);
      } else if (body.items?.length) {
        const first = body.items[0]; setSelectedId(first.id); setDraft(first); setRawJson(prettyJson(first));
      } else { setSelectedId(null); setDraft(null); setRawJson(''); }
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : '加载失败' }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (active !== 'dashboard') void load(active); }, [active, load]);

  useEffect(() => {
    if (active !== 'dashboard') return;
    let cancelled = false;
    Promise.all(['moments', 'posts', 'chatters', 'albums', 'projects', 'friends'].map(async (type) => {
      const response = await fetch(`/api/admin/content/${type}`, { cache: 'no-store' });
      if (!response.ok) return [type, 0] as const;
      const body = await response.json(); return [type, body.items?.length || 0] as const;
    })).then((values) => { if (!cancelled) setCounts(Object.fromEntries(values)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [active]);

  function choose(item: RecordItem) { setSelectedId(item.id); setDraft(item); setRawJson(prettyJson(item)); setNotice(null); }

  function addNew() {
    if (active === 'dashboard' || active === 'profile' || active === 'about' || active === 'site-settings') return;
    const item = defaultItem(active); setSelectedId(item.id); setDraft(item); setRawJson(prettyJson(item));
    setNotice({ kind: 'ok', text: '已创建本地草稿，点击保存后才会提交到 GitHub。' });
  }

  async function save() {
    if (active === 'dashboard' || !data) return;
    setSaving(true); setNotice(null);
    try {
      const id = selectedId;
      let value: any;
      if (active === 'profile' || active === 'site-settings') value = JSON.parse(rawJson);
      else value = id && draft ? { ...draft, id } : draft;
      const itemMode = Boolean(id && (markdownTypes.has(active) || arrayTypes.has(active)));
      const endpoint = itemMode ? `/api/admin/content/${active}/${encodeURIComponent(id as string)}` : `/api/admin/content/${active}`;
      const baseSha = arrayTypes.has(active) ? data.sha : id ? data.items.find((item) => item.id === id)?.sha : data.sha;
      const response = await fetch(endpoint, { method: itemMode ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value, baseSha: baseSha || null, message: commitMessage }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '保存失败');
      setNotice({ kind: 'ok', text: `已提交 ${body.path || labelFor(active)}，Vercel 会在 GitHub commit 后重新构建。` }); await load(active);
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : '保存失败' }); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (active === 'dashboard' || !selectedId || !data || (!markdownTypes.has(active) && !arrayTypes.has(active))) return;
    if (!window.confirm(`确认删除「${selectedId}」？此操作会创建 GitHub 删除 commit。`)) return;
    setSaving(true); setNotice(null);
    try {
      const item = data.items.find((entry) => entry.id === selectedId);
      const response = await fetch(`/api/admin/content/${active}/${encodeURIComponent(selectedId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseSha: item?.sha || data.sha, message: commitMessage.replace('update', 'delete') }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '删除失败');
      setNotice({ kind: 'ok', text: '删除已提交到 GitHub。' }); await load(active);
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : '删除失败' }); }
    finally { setSaving(false); }
  }

  async function logout() { await fetch('/api/admin/auth/logout', { method: 'POST' }); window.location.href = '/admin'; }
  const groupedTabs = ['概览', '站点', '内容', '数据'];

  return (
    <main className="min-h-screen bg-slate-950/70 px-4 py-6 text-slate-100 sm:px-8 lg:px-12"><div className="mx-auto max-w-7xl">
      <header className="mb-8 flex flex-col gap-5 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.35em] text-indigo-300">Owner Admin Console</p><h1 className="mt-2 text-3xl font-black tracking-tight">内容控制台</h1><p className="mt-2 text-sm text-slate-400">Git-backed CMS · 当前 Owner：{session.login}</p></div><div className="flex items-center gap-3">{session.avatarUrl && <img src={session.avatarUrl} alt="GitHub avatar" className="h-9 w-9 rounded-full border border-white/20" />}<button onClick={logout} className="rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-300 transition hover:border-white/30 hover:text-white">退出</button><Link href="/" className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold transition hover:bg-indigo-400">查看网站</Link></div></header>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]"><aside className="h-fit rounded-3xl border border-white/10 bg-slate-900/70 p-3 shadow-xl lg:sticky lg:top-6">{groupedTabs.map((group) => <div key={group} className="mb-5 last:mb-0"><p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.25em] text-slate-500">{group}</p>{tabs.filter((tab) => tab.group === group).map((tab) => <button key={tab.id} onClick={() => setActive(tab.id)} className={`mb-1 w-full rounded-xl px-3 py-2.5 text-left text-sm transition ${active === tab.id ? 'bg-indigo-500 font-bold text-white shadow-lg shadow-indigo-950/40' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>{tab.label}{tab.id !== 'dashboard' && counts[tab.id] !== undefined && <span className="float-right text-xs opacity-60">{counts[tab.id]}</span>}</button>)}</div>)}</aside>
        <section className="min-w-0">{active === 'dashboard' ? <Dashboard counts={counts} onSelect={setActive} /> : <><div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm text-indigo-300">内容管理</p><h2 className="mt-1 text-2xl font-black">{labelFor(active)}</h2><p className="mt-1 text-sm text-slate-400">{data?.path || '读取中…'}</p></div>{!['profile', 'about', 'site-settings'].includes(active) && <button onClick={addNew} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold transition hover:bg-white/15">+ 新建</button>}</div>
          {notice && <div className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${notice.kind === 'ok' ? 'border-emerald-400/30 bg-emerald-950/30 text-emerald-200' : 'border-rose-400/30 bg-rose-950/30 text-rose-200'}`}>{notice.text}</div>}
          <div className={`grid gap-5 ${data?.items?.length ? 'xl:grid-cols-[260px_1fr]' : ''}`}>{data?.items?.length ? <div className="max-h-[680px] overflow-y-auto rounded-3xl border border-white/10 bg-slate-900/65 p-2">{data.items.map((item) => <button key={item.id} onClick={() => choose(item)} className={`mb-2 w-full rounded-2xl px-4 py-3 text-left transition last:mb-0 ${selectedId === item.id ? 'bg-indigo-500/90 text-white' : 'bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]'}`}><p className="truncate font-bold">{item.frontmatter?.title || item.title || item.name || item.id}</p><p className="mt-1 truncate text-xs opacity-60">{item.id}</p></button>)}</div> : null}<div className="rounded-3xl border border-white/10 bg-slate-900/65 p-5 shadow-xl sm:p-7">{loading ? <p className="py-16 text-center text-slate-400">正在从 GitHub 读取最新内容…</p> : <Editor type={active} draft={draft} rawJson={rawJson} setDraft={setDraft} setRawJson={setRawJson} />}</div></div>
          <div className="mt-5 flex flex-col gap-3 rounded-3xl border border-white/10 bg-slate-900/65 p-5 sm:flex-row sm:items-center"><input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm outline-none ring-indigo-400 transition focus:ring-2" placeholder="Git commit message" />{selectedId && (markdownTypes.has(active) || arrayTypes.has(active)) && <button disabled={saving} onClick={remove} className="rounded-xl border border-rose-400/30 px-5 py-3 text-sm font-bold text-rose-200 transition hover:bg-rose-950/40 disabled:opacity-50">删除</button>}<button disabled={saving || loading} onClick={save} className="rounded-xl bg-indigo-500 px-6 py-3 text-sm font-bold text-white transition hover:bg-indigo-400 disabled:opacity-50">{saving ? '提交中…' : '保存并提交'}</button></div></>}</section>
      </div>
    </div></main>
  );
}

function Dashboard({ counts, onSelect }: { counts: Record<string, number>; onSelect: (type: ContentType) => void }) {
  const cards: Array<[ContentType, string, string]> = [['moments', '说说', '生活瞬间与短记录'], ['posts', '文章', 'Markdown 长文'], ['chatters', '杂谈', '碎片化思考'], ['albums', '相册', '照片与图注'], ['projects', '项目', '项目卡片'], ['friends', '友链', '友情链接']];
  return <><div className="mb-6 rounded-3xl border border-indigo-400/20 bg-indigo-950/30 p-6 sm:p-8"><p className="text-sm font-bold text-indigo-200">Git-backed publishing</p><h2 className="mt-2 text-3xl font-black">今天想更新什么？</h2><p className="mt-3 max-w-2xl leading-7 text-slate-400">所有保存都会生成可追溯的 GitHub commit。服务端会用 SHA 检查并发修改，避免误覆盖其他内容。</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([id, title, description]) => <button key={id} onClick={() => onSelect(id)} className="rounded-3xl border border-white/10 bg-slate-900/65 p-5 text-left transition hover:-translate-y-1 hover:border-indigo-400/40 hover:bg-slate-900"><div className="flex items-end justify-between"><h3 className="text-lg font-black">{title}</h3><span className="text-3xl font-black text-indigo-300">{counts[id] ?? '—'}</span></div><p className="mt-3 text-sm text-slate-400">{description}</p></button>)}</div><div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/65 p-6"><h3 className="font-black">安全边界</h3><div className="mt-4 grid gap-3 text-sm text-slate-400 sm:grid-cols-3"><p>✓ Owner GitHub OAuth</p><p>✓ HttpOnly 会话 Cookie</p><p>✓ 服务端保存 PAT</p></div></div></>;
}

function Editor({ type, draft, rawJson, setDraft, setRawJson }: { type: ContentType; draft: RecordItem | null; rawJson: string; setDraft: (value: RecordItem | null) => void; setRawJson: (value: string) => void }) {
  if (type === 'about' || markdownTypes.has(type)) return <MarkdownEditor draft={draft} setDraft={setDraft} label={`${labelFor(type)} Markdown`} />;
  if (type === 'profile') return <ProfileEditor rawJson={rawJson} setRawJson={setRawJson} />;
  return <JsonEditor rawJson={rawJson} setRawJson={setRawJson} />;
}

function ProfileEditor({ rawJson, setRawJson }: { rawJson: string; setRawJson: (value: string) => void }) { return <div><h3 className="mb-2 text-lg font-black">站点身份与个人资料</h3><p className="mb-5 text-sm text-slate-400">保存时只更新 `data/site-settings.json`，不会破坏其他站点配置。</p><textarea value={rawJson} onChange={(event) => setRawJson(event.target.value)} className="min-h-[440px] w-full rounded-2xl border border-white/10 bg-slate-950/70 p-4 font-mono text-sm leading-6 text-slate-200 outline-none ring-indigo-400 focus:ring-2" spellCheck={false} /></div>; }
function JsonEditor({ rawJson, setRawJson }: { rawJson: string; setRawJson: (value: string) => void }) { return <div><h3 className="mb-2 text-lg font-black">JSON 数据编辑器</h3><p className="mb-5 text-sm text-slate-400">可编辑当前对象的完整 JSON。保存前会校验 JSON 格式。</p><textarea value={rawJson} onChange={(event) => setRawJson(event.target.value)} className="min-h-[520px] w-full rounded-2xl border border-white/10 bg-slate-950/70 p-4 font-mono text-sm leading-6 text-slate-200 outline-none ring-indigo-400 focus:ring-2" spellCheck={false} /></div>; }
function MarkdownEditor({ draft, setDraft, label }: { draft: RecordItem | null; setDraft: (value: RecordItem | null) => void; label: string }) {
  if (!draft) return <p className="py-16 text-center text-slate-400">请选择一条内容，或点击右上角“新建”。</p>;
  return <div className="space-y-5"><div><label className="mb-2 block text-sm font-bold text-slate-300">文件 ID</label><input value={draft.id || ''} onChange={(event) => setDraft({ ...draft, id: event.target.value })} className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 font-mono text-sm outline-none ring-indigo-400 focus:ring-2" /></div><div><label className="mb-2 block text-sm font-bold text-slate-300">Frontmatter JSON</label><textarea value={prettyJson(draft.frontmatter || {})} onChange={(event) => { try { setDraft({ ...draft, frontmatter: JSON.parse(event.target.value) }); } catch { /* allow incomplete JSON while typing */ } }} className="min-h-[150px] w-full rounded-xl border border-white/10 bg-slate-950/70 p-4 font-mono text-sm leading-6 outline-none ring-indigo-400 focus:ring-2" spellCheck={false} /></div><div><label className="mb-2 block text-sm font-bold text-slate-300">{label}</label><textarea value={draft.content || ''} onChange={(event) => setDraft({ ...draft, content: event.target.value })} className="min-h-[360px] w-full rounded-xl border border-white/10 bg-slate-950/70 p-4 font-mono text-sm leading-6 outline-none ring-indigo-400 focus:ring-2" /></div></div>;
}
