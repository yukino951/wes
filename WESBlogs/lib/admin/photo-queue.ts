export type QueuedPhoto = {
  id: string;
  albumId: string;
  name: string;
  caption: string;
  source?: File;
  prepared?: Blob;
  filename?: string;
  url?: string;
  status: 'queued' | 'uploaded' | 'saved' | 'published';
  error?: string;
  createdAt: number;
};

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('wes-photo-queue', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('photos', { keyPath: 'id' }).createIndex('albumId', 'albumId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法保存本地上传队列，请检查浏览器存储空间和权限。'));
    request.onblocked = () => reject(new Error('请关闭其他正在管理照片的标签页后重试。'));
  });
}

export async function readPhotoQueue(albumId: string): Promise<QueuedPhoto[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('photos', 'readonly');
      const request = transaction.objectStore('photos').index('albumId').getAll(albumId);
      request.onsuccess = () => resolve((request.result as QueuedPhoto[]).sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function writePhotoQueue(item: QueuedPhoto | string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('photos', 'readwrite');
      const store = transaction.objectStore('photos');
      if (typeof item === 'string') store.delete(item); else store.put(item);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(new Error('本地队列保存失败，可能存储空间不足。请勿关闭页面。'));
      transaction.onerror = () => reject(new Error('本地队列保存失败，请勿关闭页面。'));
    });
  } finally { db.close(); }
}
