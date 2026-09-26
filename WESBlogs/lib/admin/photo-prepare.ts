const MAX_SOURCE_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_PHOTO_BYTES = 3 * 1024 * 1024;
const DIRECT_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function formatFileSize(bytes: number) {
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

export async function preparePhotoForUpload(file: File) {
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
