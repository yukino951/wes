"use client";

import { useState, useMemo, useEffect, useRef } from 'react';
import Navbar from '../../components/Navbar';
import PageTransition from '../../components/PageTransition';
import { albums, Album } from '../../data/albums';
import { InlineTextEditor, useAdminEditMode } from '../../components/AdminEditMode';
import AdminCollectionManager from '../../components/AdminCollectionManager';
import { siteConfig } from '../../siteConfig';

type AlbumPhoto = Album['photos'][number];

const MAX_SOURCE_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_PHOTO_BYTES = 3 * 1024 * 1024;
const DIRECT_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function loadPhoto(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(source);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error('无法读取这张图片，请选择 JPG、PNG 或 WebP 照片。'));
    };
    image.src = source;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('浏览器无法处理这张图片。'));
    }, type, quality);
  });
}

async function preparePhotoForUpload(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件。');
  if (file.size > MAX_SOURCE_PHOTO_BYTES) throw new Error('原始图片不能超过 25 MB。');

  const image = await loadPhoto(file);
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  if (DIRECT_UPLOAD_TYPES.has(file.type) && file.size <= MAX_UPLOAD_PHOTO_BYTES && longestEdge <= 2400) {
    return { blob: file as Blob, filename: file.name || 'photo.jpg' };
  }

  const render = async (maxEdge: number, quality: number) => {
    const scale = Math.min(1, maxEdge / longestEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理这张图片。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasBlob(canvas, 'image/webp', quality);
  };

  let blob = await render(2400, 0.84);
  if (blob.size > MAX_UPLOAD_PHOTO_BYTES) blob = await render(1920, 0.74);
  if (blob.size > MAX_UPLOAD_PHOTO_BYTES) blob = await render(1600, 0.68);
  if (blob.size > MAX_UPLOAD_PHOTO_BYTES) throw new Error('图片压缩后仍超过 3 MB，请选择尺寸更小的照片。');

  const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || 'photo';
  return { blob, filename: `${baseName}.webp` };
}

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  return fallback;
}

export default function PhotoWallClient() {
  const { editMode, workspaceView, reportStatus } = useAdminEditMode();
  const canEdit = editMode && workspaceView === 'edit';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [albumItems, setAlbumItems] = useState(albums);
  const [currentAlbum, setCurrentAlbum] = useState<Album | null>(null);
  const [selectedImage, setSelectedImage] = useState<{url: string, caption?: string} | null>(null);
  const [isAddingPhoto, setIsAddingPhoto] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState('');
  const [photoProgress, setPhotoProgress] = useState('');
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    setIsTransitioning(true);

    const timer = setTimeout(() => {
      setActiveQuery(searchQuery.toLowerCase());
      setIsTransitioning(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  const { matchedAlbums, matchedPhotos } = useMemo(() => {
    if (!activeQuery) return { matchedAlbums: albumItems, matchedPhotos: [] };

    const matchedAlbums = albumItems.filter(album =>
      album.title.toLowerCase().includes(activeQuery) ||
      album.description.toLowerCase().includes(activeQuery)
    );

    const matchedPhotos = albumItems.flatMap(album =>
      album.photos.map(p => ({ ...p, albumName: album.title }))
    ).filter(photo => photo.caption?.toLowerCase().includes(activeQuery));

    return { matchedAlbums, matchedPhotos };
  }, [activeQuery, albumItems]);

  const handleAlbumsChange = (items: Album[]) => {
    setAlbumItems(items);
    setCurrentAlbum((current) => {
      if (!current) return current;
      return items.find((album) => album.id === current.id) || null;
    });
  };

  const resetPhotoForm = () => {
    setIsAddingPhoto(false);
    setPhotoUrl('');
    setPhotoCaption('');
    setPhotoError(null);
    setPhotoFile(null);
    setPhotoPreviewUrl('');
    setUploadedPhotoUrl('');
    setPhotoProgress('');
    setIsDraggingPhoto(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const selectPhotoFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoError('请选择图片文件。');
      return;
    }
    if (file.size > MAX_SOURCE_PHOTO_BYTES) {
      setPhotoError('原始图片不能超过 25 MB。');
      return;
    }
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setUploadedPhotoUrl('');
    setPhotoUrl('');
    setPhotoError(null);
    setPhotoProgress('');
  };

  const handlePhotoInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    selectPhotoFile(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  };

  const persistAlbumPhotos = async (
    transform: (photos: AlbumPhoto[]) => AlbumPhoto[],
    message: string,
    manageSaving = true,
  ) => {
    if (!currentAlbum || (photoSaving && manageSaving)) return false;
    const albumId = currentAlbum.id;
    if (manageSaving) setPhotoSaving(true);
    setPhotoError(null);
    if (manageSaving) reportStatus('saving', '正在保存相册…');

    try {
      const readResponse = await fetch('/api/admin/content/albums', { cache: 'no-store' });
      const envelope = await readResponse.json().catch(() => null);
      if (!readResponse.ok) throw new Error(getErrorMessage(envelope, '无法读取当前相册'));

      const item = envelope?.items?.find((entry: { id: string }) => entry.id === albumId);
      if (!item) throw new Error('该相册已不存在或已被其他修改更新，请刷新页面后重试。');

      const currentPhotos: AlbumPhoto[] = Array.isArray(item.photos) ? item.photos : [];
      const nextPhotos = transform(currentPhotos);
      const nextCover = nextPhotos[nextPhotos.length - 1]?.url || '';
      const valueToSave = { ...item, photos: nextPhotos, cover: nextCover };
      const saveResponse = await fetch(`/api/admin/content/albums/${encodeURIComponent(albumId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: valueToSave,
          baseSha: item.sha || envelope?.sha || null,
          message,
        }),
      });
      const saved = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok) throw new Error(getErrorMessage(saved, '保存相册失败'));

      setCurrentAlbum((album) => album?.id === albumId
        ? { ...album, ...valueToSave, photos: nextPhotos, cover: nextCover }
        : album);
      setAlbumItems((items) => items.map((album) => album.id === albumId
        ? { ...album, ...valueToSave, photos: nextPhotos, cover: nextCover }
        : album));
      reportStatus('saved', '相册已保存到 GitHub');
      return true;
    } catch (saveError) {
      const messageText = saveError instanceof Error ? saveError.message : '保存相册失败';
      setPhotoError(messageText);
      reportStatus('error', messageText);
      return false;
    } finally {
      if (manageSaving) setPhotoSaving(false);
    }
  };

  const addPhoto = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentAlbum || photoSaving) return;
    let url = uploadedPhotoUrl || photoUrl.trim();
    if (!photoFile && (!url || (!url.startsWith('/') && !/^https?:\/\//i.test(url)))) {
      setPhotoError('请输入公开图片 URL，或以 / 开头的站内图片路径。');
      return;
    }

    if (photoFile) {
      setPhotoSaving(true);
      setPhotoError(null);
      try {
        if (!url) {
          setPhotoProgress('正在优化图片…');
          reportStatus('saving', '正在优化并上传照片…');
          const prepared = await preparePhotoForUpload(photoFile);
          setPhotoProgress(`正在上传 ${formatFileSize(prepared.blob.size)}…`);
          const formData = new FormData();
          formData.set('file', prepared.blob, prepared.filename);
          formData.set('albumId', currentAlbum.id);
          const uploadResponse = await fetch('/api/admin/upload', { method: 'POST', body: formData });
          const uploaded = await uploadResponse.json().catch(() => null);
          if (!uploadResponse.ok) throw new Error(getErrorMessage(uploaded, '图片上传失败'));
          url = String(uploaded?.url || '');
          if (!url) throw new Error('上传完成，但没有返回图片地址。');
          setUploadedPhotoUrl(url);
          setPhotoUrl(url);
        }

        setPhotoProgress('图片已上传，正在保存相册…');
        const caption = photoCaption.trim();
        const saved = await persistAlbumPhotos(
          (photos) => [...photos, { url, ...(caption ? { caption } : {}) }],
          'content: add uploaded photo from inline editor',
          false,
        );
        if (saved) resetPhotoForm();
      } catch (uploadError) {
        const messageText = uploadError instanceof Error ? uploadError.message : '图片上传失败';
        setPhotoError(messageText);
        reportStatus('error', messageText);
      } finally {
        setPhotoSaving(false);
        setPhotoProgress('');
      }
      return;
    }

    const caption = photoCaption.trim();
    const saved = await persistAlbumPhotos(
      (photos) => [...photos, { url, ...(caption ? { caption } : {}) }],
      'content: add photo from inline editor',
    );
    if (saved) resetPhotoForm();
  };

  const deletePhoto = (event: React.MouseEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (!currentAlbum || photoSaving || !currentAlbum.photos[index]) return;
    if (!window.confirm('确定删除这张照片吗？该操作会保存到 GitHub。')) return;
    void persistAlbumPhotos(
      (photos) => photos.filter((_, photoIndex) => photoIndex !== index),
      'content: delete photo from inline editor',
    );
  };

  return (
    <div className="min-h-screen relative pb-32">
      <Navbar />

      <PageTransition>
        <div className="w-full max-w-7xl mx-auto mt-28 px-4 sm:px-10 relative z-10">

          <AdminCollectionManager
            type="albums"
            initialItems={albumItems}
            onItemsChange={(items) => handleAlbumsChange(items as unknown as Album[])}
          />

          {!currentAlbum && (
            <div className="animate-fade-in-up">
              <div className="flex flex-col md:flex-row justify-between items-center mb-16 gap-6">
                <div>
                  <InlineTextEditor
                    as="h1"
                    value={siteConfig.photoWallTitle}
                    resource={{ type: 'profile', field: 'photoWallTitle' }}
                    className="text-4xl md:text-5xl font-black text-slate-900 dark:text-white tracking-widest mb-2 transition-colors duration-700"
                  />
                  <InlineTextEditor
                    as="p"
                    value={siteConfig.photoWallDescription}
                    resource={{ type: 'profile', field: 'photoWallDescription' }}
                    className="text-slate-600 dark:text-slate-400 font-medium tracking-wider transition-colors duration-700"
                    multiline
                  />
                </div>

                <div className="relative w-full md:w-80 group">
                  <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 z-10 pointer-events-none text-slate-500 dark:text-slate-400 group-focus-within:text-indigo-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="搜索相册名或照片描述..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-12 pl-12 pr-4 bg-white/40 dark:bg-slate-800/40 backdrop-blur-md border border-white/50 dark:border-white/10 rounded-full text-sm text-slate-800 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-sm transition-all duration-700"
                  />
                </div>
              </div>

              <div className={`transition-opacity duration-300 ease-in-out ${isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>

                {activeQuery && matchedPhotos.length > 0 && (
                  <div className="mb-16">
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-6 flex items-center gap-2">
                      <span className="w-2 h-6 bg-indigo-500 rounded-full"></span>
                      匹配的单张照片 ({matchedPhotos.length})
                    </h3>
                    <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-6 space-y-6">
                      {matchedPhotos.map((photo, index) => (
                        <div
                          key={`search-photo-${index}`}
                          onClick={() => setSelectedImage(photo)}
                          className="break-inside-avoid relative group rounded-2xl overflow-hidden cursor-zoom-in shadow-lg bg-white/20 dark:bg-slate-800/20 border border-white/30 dark:border-white/10 transition-transform duration-500 hover:scale-[1.02] hover:shadow-2xl hover:shadow-indigo-500/20"
                        >
                          <img src={photo.url} alt={photo.caption} className="w-full h-auto object-cover transform transition-transform duration-700 group-hover:scale-105" loading="lazy" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-5">
                            <span className="text-indigo-300 font-black text-[10px] tracking-widest uppercase mb-1 drop-shadow-md">{photo.albumName}</span>
                            <p className="text-white font-medium text-sm drop-shadow-md translate-y-4 group-hover:translate-y-0 transition-transform duration-500">{photo.caption}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeQuery && matchedAlbums.length > 0 && (
                  <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-6 flex items-center gap-2">
                    <span className="w-2 h-6 bg-purple-500 rounded-full"></span>
                    相关相册 ({matchedAlbums.length})
                  </h3>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-20 mt-10">
                  {matchedAlbums.map((album) => (
                    <div
                      key={album.id}
                      onClick={() => { setSearchQuery(''); setCurrentAlbum(album); }}
                      className="group cursor-pointer flex flex-col items-center"
                    >
                      <div className="relative w-[85%] aspect-[4/3] mb-8">
                        <div className="absolute inset-0 bg-slate-300 dark:bg-slate-700 rounded-[4px] shadow-md transform rotate-6 translate-x-4 translate-y-2 group-hover:rotate-12 group-hover:translate-x-8 transition-all duration-500 border-[6px] border-white dark:border-slate-200 overflow-hidden opacity-60">
                           {album.photos[2] && <img src={album.photos[2].url} className="w-full h-full object-cover grayscale blur-[2px]" alt="" />}
                        </div>
                        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-600 rounded-[4px] shadow-lg transform -rotate-3 -translate-x-2 -translate-y-1 group-hover:-rotate-6 group-hover:-translate-x-6 transition-all duration-500 border-[6px] border-white dark:border-slate-200 overflow-hidden opacity-80 z-10">
                           {album.photos[1] && <img src={album.photos[1].url} className="w-full h-full object-cover grayscale-[50%]" alt="" />}
                        </div>
                        <div className="absolute inset-0 bg-white dark:bg-slate-200 rounded-[4px] shadow-2xl border-[6px] border-white dark:border-slate-200 overflow-hidden z-20 transform group-hover:-translate-y-2 group-hover:scale-105 transition-all duration-500 relative">
                          <img src={album.photos[album.photos.length - 1]?.url || album.cover} alt={album.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-5">
                            <span className="text-white font-bold text-lg drop-shadow-md translate-y-2 group-hover:translate-y-0 transition-transform duration-500">{album.photos.length} 张照片</span>
                            <span className="text-indigo-300 font-medium text-xs mt-1 drop-shadow-md translate-y-2 group-hover:translate-y-0 transition-transform duration-500 delay-75">Click to Open</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-center px-4 w-full">
                        <div className="flex items-center justify-center gap-2 mb-1">
                          <InlineTextEditor
                            as="h2"
                            value={album.title}
                            resource={{ type: 'albums', id: album.id, field: 'title' }}
                            className="text-xl font-bold text-slate-900 dark:text-white transition-colors group-hover:text-indigo-600 dark:group-hover:text-indigo-400"
                          />
                          <InlineTextEditor
                            value={album.date}
                            resource={{ type: 'albums', id: album.id, field: 'date' }}
                            className="text-[10px] font-black text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-black/30 backdrop-blur-sm px-2 py-0.5 rounded-sm uppercase tracking-wider"
                          />
                        </div>
                        <InlineTextEditor
                          as="p"
                          value={album.description}
                          resource={{ type: 'albums', id: album.id, field: 'description' }}
                          className="text-sm text-slate-600 dark:text-slate-400 line-clamp-1"
                          multiline
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {activeQuery && matchedAlbums.length === 0 && matchedPhotos.length === 0 && (
                  <div className="text-center py-20 text-slate-500 font-medium">
                    在泰拉大陆的任何角落都没找到相关的记忆...
                  </div>
                )}
              </div>
            </div>
          )}

          {currentAlbum && (
            <div className="animate-fade-in-up">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-4 border-b border-slate-300/50 dark:border-slate-700/50 pb-6">
                <div>
                  <div className="flex items-center gap-4 mb-4">
                    <button
                      onClick={() => { setCurrentAlbum(null); resetPhotoForm(); }}
                      className="group flex items-center gap-1.5 text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                      <span className="bg-white/40 dark:bg-slate-800/50 backdrop-blur-md p-1.5 rounded-lg border border-white/50 dark:border-white/10 shadow-sm group-hover:shadow-md transition-all">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                      </span>
                      返回画廊
                    </button>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700"></span>
                    <InlineTextEditor
                      value={currentAlbum.date}
                      resource={{ type: 'albums', id: currentAlbum.id, field: 'date' }}
                      className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest"
                    />
                  </div>
                  <InlineTextEditor
                    as="h1"
                    value={currentAlbum.title}
                    resource={{ type: 'albums', id: currentAlbum.id, field: 'title' }}
                    className="text-4xl md:text-5xl font-black text-slate-900 dark:text-white tracking-wider mb-2"
                  />
                  <InlineTextEditor
                    as="p"
                    value={currentAlbum.description}
                    resource={{ type: 'albums', id: currentAlbum.id, field: 'description' }}
                    className="text-slate-600 dark:text-slate-400 font-medium text-lg"
                    multiline
                  />
                </div>

                <div className="text-sm font-bold text-slate-500 dark:text-slate-400 bg-white/40 dark:bg-slate-800/40 backdrop-blur-md px-5 py-2.5 rounded-2xl border border-white/50 dark:border-white/10 shadow-sm">
                  共 <span className="text-indigo-500 dark:text-indigo-400 text-lg">{currentAlbum.photos.length}</span> 瞬间
                </div>
              </div>

              {canEdit && (
                <div className="mb-8 rounded-2xl border border-dashed border-indigo-400/60 bg-indigo-500/5 p-4 shadow-sm">
                  {!isAddingPhoto ? (
                    <button
                      type="button"
                      onClick={() => { setPhotoError(null); setIsAddingPhoto(true); }}
                      className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-indigo-400"
                    >
                      + 添加照片
                    </button>
                  ) : (
                    <form onSubmit={addPhoto} className="flex flex-col gap-3">
                      <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoInput} className="hidden" />
                      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoInput} className="hidden" />
                      <div
                        onDragEnter={(event) => { event.preventDefault(); setIsDraggingPhoto(true); }}
                        onDragOver={(event) => { event.preventDefault(); setIsDraggingPhoto(true); }}
                        onDragLeave={() => setIsDraggingPhoto(false)}
                        onDrop={(event) => {
                          event.preventDefault();
                          setIsDraggingPhoto(false);
                          selectPhotoFile(event.dataTransfer.files?.[0]);
                        }}
                        className={`rounded-2xl border-2 border-dashed p-4 transition ${isDraggingPhoto ? 'border-indigo-400 bg-indigo-500/15' : 'border-indigo-300/50 bg-white/30 dark:bg-slate-950/30'}`}
                      >
                        {photoPreviewUrl ? (
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                            <img src={photoPreviewUrl} alt="待上传照片预览" className="h-32 w-full rounded-xl object-cover shadow-lg sm:w-44" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-black text-slate-900 dark:text-white">{photoFile?.name}</p>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">原图 {photoFile ? formatFileSize(photoFile.size) : ''}，上传前会自动压缩到 3 MB 以内。</p>
                              <button
                                type="button"
                                disabled={photoSaving}
                                onClick={() => {
                                  setPhotoFile(null);
                                  setPhotoPreviewUrl('');
                                  setUploadedPhotoUrl('');
                                  setPhotoUrl('');
                                }}
                                className="mt-3 rounded-lg bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-white dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                              >
                                重新选择
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center px-3 py-6 text-center">
                            <svg className="h-9 w-9 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 16.5V18a2.5 2.5 0 002.5 2.5h13A2.5 2.5 0 0021 18v-1.5M8 7l4-4m0 0l4 4m-4-4v13" />
                            </svg>
                            <p className="mt-3 text-sm font-black text-slate-900 dark:text-white">拖一张图片到这里</p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">电脑可拖拽；手机点击下方按钮访问相册或相机。</p>
                            <div className="mt-4 flex flex-wrap justify-center gap-2">
                              <button type="button" disabled={photoSaving} onClick={() => fileInputRef.current?.click()} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-indigo-400 disabled:opacity-50">
                                从相册 / 文件选择
                              </button>
                              <button type="button" disabled={photoSaving} onClick={() => cameraInputRef.current?.click()} className="rounded-xl border border-indigo-300/50 bg-white/60 px-4 py-2 text-sm font-bold text-indigo-700 transition hover:bg-white disabled:opacity-50 dark:bg-slate-900/70 dark:text-indigo-200 dark:hover:bg-slate-800">
                                拍照上传
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="flex flex-col gap-1 text-sm font-bold text-slate-700 dark:text-slate-200">
                          或者使用图片地址
                          <input
                            type="text"
                            value={photoUrl}
                            onChange={(event) => setPhotoUrl(event.target.value)}
                            disabled={Boolean(photoFile) || photoSaving}
                            placeholder="https://example.com/photo.jpg"
                            className="rounded-xl border border-indigo-300/60 bg-white/80 px-3 py-2 text-slate-900 outline-none ring-indigo-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-950/80 dark:text-white"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm font-bold text-slate-700 dark:text-slate-200">
                          照片说明（可选）
                          <input
                            value={photoCaption}
                            onChange={(event) => setPhotoCaption(event.target.value)}
                            placeholder="这张照片的描述"
                            className="rounded-xl border border-indigo-300/60 bg-white/80 px-3 py-2 text-slate-900 outline-none ring-indigo-400 focus:ring-2 dark:bg-slate-950/80 dark:text-white"
                          />
                        </label>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">支持 JPG、PNG、WebP 和手机可读取的照片格式；也可以继续使用公开 URL 或站内路径。</p>
                      {photoProgress ? <p role="status" className="text-sm font-bold text-indigo-600 dark:text-indigo-300">{photoProgress}</p> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="submit" disabled={photoSaving || (!photoFile && !photoUrl.trim())} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50">
                          {photoSaving ? (photoProgress || '保存中…') : photoFile ? '上传并保存照片' : '保存照片'}
                        </button>
                        <button type="button" disabled={photoSaving} onClick={resetPhotoForm} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-600 disabled:opacity-50">
                          取消
                        </button>
                      </div>
                    </form>
                  )}
                  {photoError && <p className="mt-3 text-sm font-medium text-rose-500 dark:text-rose-300">{photoError}</p>}
                </div>
              )}

              <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-6 space-y-6">
                {currentAlbum.photos.map((photo, index) => (
                  <div
                    key={`${photo.url}-${index}`}
                    onClick={() => setSelectedImage(photo)}
                    className="break-inside-avoid relative group rounded-2xl overflow-hidden cursor-zoom-in shadow-lg bg-white/20 dark:bg-slate-800/20 border border-white/30 dark:border-white/10 transition-transform duration-500 hover:scale-[1.02] hover:shadow-2xl hover:shadow-indigo-500/20 animate-fade-in-up"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <img src={photo.url} alt={photo.caption || '照片'} className="w-full h-auto object-cover transform transition-transform duration-700 group-hover:scale-105" loading="lazy" />
                    {canEdit && (
                      <button
                        type="button"
                        onClick={(event) => deletePhoto(event, index)}
                        disabled={photoSaving}
                        className="absolute right-3 top-3 z-20 rounded-lg bg-rose-600/90 px-3 py-1.5 text-xs font-bold text-white opacity-100 shadow-lg transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100"
                        title="删除这张照片"
                      >
                        删除
                      </button>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-5">
                      {photo.caption && (
                        <p className="text-white font-medium text-sm drop-shadow-md translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
                          {photo.caption}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </PageTransition>

      {selectedImage && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-4 sm:p-10 cursor-zoom-out animate-fade-in"
          onClick={() => setSelectedImage(null)}
        >
          <button className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors bg-white/10 hover:bg-white/20 rounded-full p-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          <img
            src={selectedImage.url}
            alt={selectedImage.caption || '全屏照片'}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />

          {selectedImage.caption && (
            <div className="absolute bottom-10 px-6 py-3 bg-white/10 backdrop-blur-md border border-white/10 rounded-full text-white text-sm font-medium tracking-wide shadow-2xl">
              {selectedImage.caption}
            </div>
          )}
        </div>
      )}

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
      `}</style>
    </div>
  );
}
