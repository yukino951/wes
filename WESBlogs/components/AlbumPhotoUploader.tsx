'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminEditMode } from './AdminEditMode';
import { useAdminPending, useDraftStorage } from './AdminDraftGuard';
import { preparePhotoForUpload, formatFileSize } from '@/lib/admin/photo-prepare';
import { readPhotoQueue, writePhotoQueue, type QueuedPhoto } from '@/lib/admin/photo-queue';

type Photo = { url: string; caption?: string };
type Props = {
  albumId: string;
  onSave: (photo: Photo) => Promise<void>;
  onPreview: (url: string, blob: Blob) => void;
  onPublished: (url: string) => void;
  onRestore: (albumId: string, photo: Photo) => void;
  onBusy: (busy: boolean) => void;
};

function Preview({ item }: { item: QueuedPhoto }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const blob = item.prepared || item.source;
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    if (imageRef.current) imageRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return blob || item.status === 'published' ? <img ref={imageRef} src={blob ? undefined : item.url} alt={item.name} className="h-20 w-20 shrink-0 rounded-xl object-cover" /> : <div className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-xs">照片</div>;
}

export default function AlbumPhotoUploader({ albumId, onSave, onPreview, onPublished, onRestore, onBusy }: Props) {
  const { reportStatus } = useAdminEditMode();
  const [items, setItems] = useState<QueuedPhoto[]>([]);
  const queueRef = useRef<QueuedPhoto[]>([]);
  const writesRef = useRef<Promise<void>>(Promise.resolve());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState('');
  const urlDraft = useDraftStorage(`photo-url:${albumId}`);
  const readUrlDraft = urlDraft.read;
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  useAdminPending(items.some((item) => item.status === 'queued' || item.status === 'uploaded') || Boolean(url.trim()), busy);

  const update = useCallback(async (item: QueuedPhoto) => {
    const next = queueRef.current.some((entry) => entry.id === item.id)
      ? queueRef.current.map((entry) => entry.id === item.id ? item : entry)
      : [...queueRef.current, item];
    queueRef.current = next;
    setItems(next);
    const write = writesRef.current.catch(() => {}).then(() => writePhotoQueue(item));
    writesRef.current = write;
    await write;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readPhotoQueue(albumId).then(async (loaded) => {
      let livePhotos: string[] = [];
      if (loaded.some((item) => item.status === 'saved')) {
        try {
          const response = await fetch('/api/admin/content/albums', { cache: 'no-store' });
          if (response.ok) {
            const body = await response.json();
            const liveAlbum = body?.items?.find((entry: { id: string }) => entry.id === albumId);
            livePhotos = Array.isArray(liveAlbum?.photos) ? liveAlbum.photos.map((photo: Photo) => photo.url) : [];
          }
        } catch { /* Queue previews remain available when the live read fails. */ }
      }
      if (cancelled) return;
      queueRef.current = loaded;
      setItems(loaded);
      setUrl(readUrlDraft() || '');
      for (const item of loaded) {
        if (item.url && (item.prepared || item.source)) onPreview(item.url, (item.prepared || item.source)!);
        if (item.url && item.status === 'saved' && livePhotos.includes(item.url)) onRestore(albumId, { url: item.url, caption: item.caption });
      }
      setReady(true);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '无法读取上传队列'); });
    return () => { cancelled = true; };
  }, [albumId, onPreview, onRestore, readUrlDraft]);

  const checkPublication = useCallback(async () => {
    if (busyRef.current || document.visibilityState !== 'visible') return;
    const response = await fetch(`/api/admin/publication?albumId=${encodeURIComponent(albumId)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('暂时无法确认发布状态，已保存的照片不会丢失，可稍后再次检查。');
    const result = await response.json();
    const urls: string[] = Array.isArray(result.urls) ? result.urls : [];
    for (const item of queueRef.current) {
      if (item.status !== 'saved' || !item.url || !urls.includes(item.url)) continue;
      // Local assets and album metadata must both be available in production.
      if (item.url.startsWith('/')) {
        const asset = await fetch(`${item.url}?publication=1`, { method: 'HEAD', cache: 'no-store' });
        if (!asset.ok) continue;
      }
      await update({ ...item, status: 'published', prepared: undefined, source: undefined, error: undefined });
      onPublished(item.url);
    }
  }, [albumId, onPublished, update]);

  const waiting = items.filter((item) => item.status === 'saved').map((item) => item.id).join(',');
  useEffect(() => {
    if (!waiting) return;
    let attempts = 0;
    let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try { await checkPublication(); } catch { /* Manual check gives an actionable error. */ }
      finally { running = false; }
      if (++attempts >= 40) window.clearInterval(timer);
    };
    const timer = window.setInterval(() => { void check(); }, 15000);
    void check();
    return () => window.clearInterval(timer);
  }, [waiting, checkPublication]);

  const setWorking = (value: boolean) => { busyRef.current = value; setBusy(value); onBusy(value); };
  const addFiles = async (files: File[]) => {
    if (!ready || busyRef.current || !files.length) return;
    const pendingCount = queueRef.current.filter((item) => item.status !== 'published').length;
    if (files.length + pendingCount > 20) { setError('每次最多保留 20 张待处理照片，请先完成当前队列。'); return; }
    setWorking(true);
    setError('');
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/') || file.size <= 0 || file.size > 25 * 1024 * 1024) throw new Error(`${file.name}：请选择不超过 25 MB 的图片。`);
        await update({ id: crypto.randomUUID(), albumId, name: file.name, source: file, caption: '', status: 'queued', createdAt: Date.now() });
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法加入队列'); }
    finally { setWorking(false); }
  };

  const saveQueue = async (onlyId?: string) => {
    if (!ready || busyRef.current) return;
    setWorking(true);
    setError('');
    try { await writesRef.current; }
    catch { setError('本地草稿尚未保存，请检查浏览器存储空间后重试。'); setWorking(false); return; }
    const selected = queueRef.current.filter((item) => (!onlyId || item.id === onlyId) && (item.status === 'queued' || item.status === 'uploaded'));
    for (let index = 0; index < selected.length; index++) {
      let item = selected[index];
      try {
        setProgress(`正在处理 ${index + 1} / ${selected.length}：${item.name}`);
        reportStatus('saving', '正在上传并保存照片…');
        if (!item.url) {
          if (!item.prepared) {
            if (!item.source) throw new Error('本地图片已不可用，请移出队列后重新选择。');
            const prepared = await preparePhotoForUpload(item.source);
            item = { ...item, prepared: prepared.blob, filename: prepared.filename, source: undefined };
            await update(item);
          }
          const form = new FormData();
          form.set('file', item.prepared!, item.filename || item.name);
          form.set('albumId', albumId);
          const response = await fetch('/api/admin/upload', { method: 'POST', body: form });
          const uploaded = await response.json().catch(() => null);
          if (!response.ok || typeof uploaded?.url !== 'string') throw new Error(uploaded?.error || '图片上传失败，请重试');
          item = { ...item, url: uploaded.url, status: 'uploaded', error: undefined };
          await update(item);
          onPreview(item.url!, item.prepared!);
        }
        await onSave({ url: item.url!, caption: item.caption.trim() });
        item = { ...item, status: 'saved', error: undefined };
        await update(item);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '保存失败';
        try { await update({ ...item, error: message }); } catch { setError('本地进度保存失败，请保持页面打开并重试。'); }
      }
    }
    const failed = queueRef.current.some((item) => item.error);
    reportStatus(failed ? 'error' : 'saved', failed ? '部分照片未完成，可逐张重试' : '照片已保存，正在等待网站发布');
    setProgress('');
    setWorking(false);
  };

  const addUrl = async () => {
    if (busyRef.current || !url.trim()) return;
    const value = url.trim();
    if (!/^(https?:\/\/|\/(?!\/))/.test(value)) { setError('请输入完整的 HTTP(S) 图片地址或站内路径。'); return; }
    if (queueRef.current.filter((item) => item.status !== 'published').length >= 20) { setError('请先完成当前队列后再添加。'); return; }
    setWorking(true);
    try {
      await update({ id: crypto.randomUUID(), albumId, name: '链接照片', url: value, caption: '', status: 'uploaded', createdAt: Date.now() });
      setUrl(''); setError('');
      urlDraft.clear();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法加入队列'); }
    finally { setWorking(false); }
  };

  const removeItem = async (id: string) => {
    if (busyRef.current) return;
    setWorking(true);
    try {
      await writesRef.current.catch(() => {});
      await writePhotoQueue(id);
      queueRef.current = queueRef.current.filter((entry) => entry.id !== id);
      setItems(queueRef.current);
    } catch { setError('无法清除本地记录，请重试。'); }
    finally { setWorking(false); }
  };

  const inputClass = 'w-full rounded-xl border border-indigo-300/40 bg-white/80 px-3 py-2 text-sm text-slate-900 dark:bg-slate-950 dark:text-white';
  return <section aria-label="添加照片" className="mb-8 space-y-4 rounded-2xl border border-indigo-300/40 bg-white/70 p-4 dark:bg-slate-900/90">
    <div onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }} className={`rounded-xl border-2 border-dashed p-5 text-center ${dragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-indigo-300/40'}`}>
      <p className="font-bold text-slate-900 dark:text-white">拖入多张照片，或从相册选择</p>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">每张原图最多 25 MB，自动优化后上传。未完成的队列保存在此浏览器，重新打开相册可继续。</p>
      <input ref={fileRef} type="file" accept="image/*" multiple disabled={busy || !ready} className="hidden" onChange={(event) => { void addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" disabled={busy || !ready} className="hidden" onChange={(event) => { void addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <button type="button" disabled={busy || !ready} onClick={() => fileRef.current?.click()} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">从相册 / 文件选择</button>
        <button type="button" disabled={busy || !ready} onClick={() => cameraRef.current?.click()} className="rounded-xl border border-indigo-300 px-4 py-2 text-sm font-bold text-indigo-600 disabled:opacity-50 dark:text-indigo-300">拍照</button>
      </div>
    </div>
    <details><summary className="cursor-pointer text-sm text-slate-600 dark:text-slate-300">使用图片地址</summary><div className="mt-3 flex gap-2"><input aria-label="图片地址" value={url} disabled={busy || !ready} onChange={(event) => { setUrl(event.target.value); urlDraft.write(event.target.value); }} placeholder="https://example.com/photo.jpg" className={inputClass} /><button type="button" disabled={busy || !ready} onClick={() => void addUrl()} className="shrink-0 rounded-xl bg-indigo-500 px-3 text-sm text-white">加入队列</button></div></details>
    {items.map((item) => <div key={item.id} className="flex items-start gap-3 rounded-xl border border-slate-300/30 p-3">
      <Preview item={item} />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{item.name}{item.prepared ? ` · ${formatFileSize(item.prepared.size)}` : ''}</p>
        <input aria-label={`${item.name} 的照片说明`} placeholder="照片说明（可选）" value={item.caption} disabled={busy || item.status === 'saved' || item.status === 'published'} onChange={(event) => { void update({ ...item, caption: event.target.value }).catch(() => setError('说明未能保存到本地，请重试。')); }} className={inputClass} />
        <p role="status" className={`text-xs ${item.error ? 'text-rose-500' : 'text-slate-500 dark:text-slate-300'}`}>{item.error || (item.status === 'published' ? '已在网站发布' : item.status === 'saved' ? '已保存 · 等待网站发布，预览会继续保留' : item.status === 'uploaded' ? '图片已就绪 · 等待保存相册' : '待上传')}</p>
        <div className="flex flex-wrap gap-3 text-xs">
          {(item.status === 'queued' || item.status === 'uploaded') && <button type="button" disabled={busy} onClick={() => void saveQueue(item.id)} className="font-bold text-indigo-500 disabled:opacity-50">{item.error ? '重试这张' : '保存这张'}</button>}
          {item.status !== 'saved' && <button type="button" disabled={busy} onClick={() => void removeItem(item.id)} className="text-slate-500">{item.status === 'published' ? '清除记录' : '移出队列'}</button>}
        </div>
      </div>
    </div>)}
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy || !items.some((item) => item.status === 'queued' || item.status === 'uploaded')} onClick={() => void saveQueue()} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? '处理中…' : '上传并保存待处理照片'}</button>
      {waiting && <button type="button" disabled={busy} onClick={() => { void checkPublication().then(() => setError('')).catch((reason) => setError(reason.message)); }} className="text-sm text-indigo-500">检查发布状态</button>}
      {progress && <p role="status" className="text-xs text-indigo-500">{progress}</p>}
    </div>
    {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
  </section>;
}
