const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const { indexedDB } = require('fake-indexeddb');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://site.test/?edit=1', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLAnchorElement', 'Element', 'Node', 'sessionStorage', 'location', 'MouseEvent', 'KeyboardEvent']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.indexedDB = indexedDB;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 30 }];
const React = require('react');
const { createRoot } = require('react-dom/client');
const cache = new Map();
const mocks = new Map();
const project = path.resolve(__dirname, '..');

// Transpile the real components and routes; mocks replace network/auth only.
function load(relative) {
  const filename = path.isAbsolute(relative) ? relative : path.join(project, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, loaded);
  const fallback = loaded.require.bind(loaded);
  loaded.require = (id) => {
    if (mocks.has(id)) return mocks.get(id);
    if (id.startsWith('.') || id.startsWith('@/')) {
      const base = id.startsWith('@/') ? path.join(project, id.slice(2)) : path.resolve(path.dirname(filename), id);
      const file = ['.ts', '.tsx'].map((extension) => base + extension).find(fs.existsSync);
      if (file) return load(file);
    }
    return fallback(id);
  };
  loaded._compile(output, filename);
  return loaded.exports;
}

const editor = load('components/AdminEditMode.tsx');
const guard = load('components/AdminDraftGuard.tsx');
const queue = load('lib/admin/photo-queue.ts');
const github = load('lib/admin/github.ts');
const validation = load('lib/admin/validation.ts');
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
async function click(element) { assert.ok(element, 'click target exists'); await React.act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick(); }); }
async function enter(element, value) {
  await React.act(async () => {
    const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await tick();
  });
}
function button(label) { return [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === label); }
let root;
async function mount(node) { root = createRoot(document.getElementById('root')); await React.act(async () => { root.render(node); await tick(); }); }
async function unmount() { if (root) await React.act(() => root.unmount()); root = null; }
after(async () => { await unmount(); dom.window.close(); });

test('text draft survives close, preview and reload; portal clicks never open the parent card', async () => {
  let navigations = 0;
  let shouldLeave = false;
  let failSave = true;
  let savedValue = 'Original';
  window.confirm = () => shouldLeave;
  window.alert = () => {};
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/admin/session') return Response.json({ authenticated: true });
    if (options.method === 'POST') {
      if (failSave) return Response.json({ error: 'simulated network failure' }, { status: 503 });
      savedValue = JSON.parse(options.body).value.authorName;
      return Response.json({ sha: 'saved' });
    }
    return Response.json({ singleton: { authorName: savedValue }, sha: 'old' });
  };
  function Controls() {
    const mode = editor.useAdminEditMode();
    return React.createElement(React.Fragment, null,
      React.createElement('button', { onClick: () => mode.setWorkspaceView('preview') }, 'Preview'),
      React.createElement('button', { onClick: () => mode.setWorkspaceView('edit') }, 'Edit'));
  }
  const tree = () => React.createElement(editor.AdminEditModeProvider, null,
    React.createElement(Controls),
    React.createElement('div', { onClick: () => { navigations++; } },
      React.createElement(editor.InlineTextEditor, { value: 'Original', resource: { type: 'profile', field: 'authorName' }, as: 'h1' })));
  await mount(tree());
  await click(document.querySelector('[role="button"]'));
  await click(document.querySelector('input'));
  assert.equal(navigations, 0);
  await enter(document.querySelector('input'), 'My draft');
  await click(button('关闭'));
  assert.ok(document.querySelector('[role="dialog"]'), 'cancelled close keeps editor open');
  shouldLeave = true;
  await click(button('Preview'));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await click(button('Edit'));
  await click(document.querySelector('[role="button"]'));
  assert.equal(document.querySelector('input').value, 'My draft');
  await click(button('保存到 GitHub'));
  assert.equal(document.querySelector('input').value, 'My draft', 'failure keeps draft');
  assert.match(document.body.textContent, /simulated network failure/);
  await unmount();
  window.history.replaceState({}, '', '/?edit=1');
  await mount(tree());
  await click(document.querySelector('[role="button"]'));
  assert.equal(document.querySelector('input').value, 'My draft', 'remount restores session draft');
  failSave = false;
  await click(button('保存到 GitHub'));
  assert.equal(savedValue, 'My draft');
  assert.equal(document.querySelector('h1').textContent, 'My draft', 'stale prop does not overwrite successful save');
  assert.equal(navigations, 0);
  await click(document.querySelector('[role="button"]'));
  assert.equal(document.querySelector('input').value, 'My draft');
  await unmount();
});

test('IndexedDB retains the prepared upload and caption through a queue reload', async () => {
  const item = { id: 'queue-test', albumId: 'test', name: 'test.webp', caption: 'caption', prepared: new Blob(['image-bytes'], { type: 'image/webp' }), status: 'uploaded', url: '/uploads/test.webp', createdAt: 1 };
  await queue.writePhotoQueue(item);
  const restored = await queue.readPhotoQueue('test');
  assert.equal(restored.length, 1);
  assert.equal(restored[0].caption, 'caption');
  assert.equal(await restored[0].prepared.text(), 'image-bytes');
  assert.equal(restored[0].status, 'uploaded');
  await queue.writePhotoQueue(item.id);
  assert.deepEqual(await queue.readPhotoQueue('test'), []);
});

test('Markdown draft survives dismissal and explicit discard removes it', async () => {
  window.confirm = () => true;
  window.history.replaceState({}, '', '/about?edit=1');
  globalThis.fetch = async () => Response.json({ authenticated: true });
  await mount(React.createElement(editor.AdminEditModeProvider, null, React.createElement(editor.InlineMarkdownEditor, { value: 'Old body', html: '<p>Old body</p>', resource: { type: 'about' } })));
  await click(document.querySelector('[role="button"]'));
  await enter(document.querySelector('textarea'), 'Draft body');
  await click(button('关闭'));
  await click(document.querySelector('[role="button"]'));
  assert.equal(document.querySelector('textarea').value, 'Draft body');
  await click(button('放弃草稿'));
  assert.equal(document.querySelector('textarea').value, 'Old body');
  await unmount();
});

test('collection manager keeps separate drafts when switching between records', async () => {
  const Manager = load('components/AdminCollectionManager.tsx').default;
  const entries = [{ id: 'first', name: 'First', description: '', url: '', avatar: '', themeColor: '' }, { id: 'second', name: 'Second', description: '', url: '', avatar: '', themeColor: '' }];
  window.confirm = () => true;
  window.history.replaceState({}, '', '/friends?edit=1');
  globalThis.fetch = async (url) => Response.json(url === '/api/admin/session' ? { authenticated: true } : { items: entries, sha: 'list' });
  await mount(React.createElement(editor.AdminEditModeProvider, null, React.createElement(Manager, { type: 'friends', initialItems: entries, onItemsChange: () => {} })));
  await click(button('管理友链'));
  const recordButton = (label) => [...document.querySelectorAll('button')].find((element) => element.querySelector('span')?.textContent === label);
  await click(recordButton('First'));
  const nameInput = () => [...document.querySelectorAll('label')].find((label) => label.textContent.trim() === '名称').querySelector('input');
  await enter(nameInput(), 'First draft');
  await click(recordButton('Second'));
  await enter(nameInput(), 'Second draft');
  await click(recordButton('First'));
  assert.equal(nameInput().value, 'First draft');
  await click(recordButton('Second'));
  assert.equal(nameInput().value, 'Second draft');
  await unmount();
});

test('a lost upload response can be retried without another GitHub write', async () => {
  const oldToken = process.env.GITHUB_ADMIN_TOKEN;
  process.env.GITHUB_ADMIN_TOKEN = 'local-test-placeholder';
  let exists = false;
  let puts = 0;
  const bytes = Buffer.from('test image');
  const sha = require('node:crypto').createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'PUT') { puts++; exists = true; throw new Error('response lost'); }
    return exists ? Response.json({ type: 'file', path: 'test.webp', sha, content: bytes.toString('base64') }) : Response.json({ message: 'not found' }, { status: 404 });
  };
  try {
    await assert.rejects(github.putBinaryContentFile('test.webp', bytes, 'test'), /response lost/);
    const result = await github.putBinaryContentFile('test.webp', bytes, 'test');
    assert.equal(result.sha, sha);
    assert.equal(puts, 1);
    await assert.rejects(github.putBinaryContentFile('test.webp', Buffer.from('different'), 'test'), (error) => error.status === 409);
  } finally { if (oldToken === undefined) delete process.env.GITHUB_ADMIN_TOKEN; else process.env.GITHUB_ADMIN_TOKEN = oldToken; }
});

test('malformed CMS data is rejected before it can reach GitHub', () => {
  assert.throws(() => validation.validateArrayItem('albums', { id: 'a', title: 'Album', photos: '{}' }), /照片必须是数组/);
  assert.throws(() => validation.validateArrayItem('albums', { id: 'a', title: 'Album', photos: [{ url: 'javascript:alert(1)' }] }), /图片地址/);
  assert.throws(() => validation.validateMarkdown({ content: [], frontmatter: {} }), /content/);
  assert.throws(() => validation.validateArrayItem('projects', { id: 'p', name: 'Project', tags: 'bad' }), /tags/);
  assert.doesNotThrow(() => validation.validateArrayItem('albums', { id: 'a', title: 'Album', cover: '/photo.png', coverMode: 'manual', photos: [{ url: '/photo.png', caption: '' }] }));
});

test('photo queue retries only album saving and retains its preview until publication', async () => {
  const uploader = load('components/AlbumPhotoUploader.tsx').default;
  const id = 'retry-photo';
  const albumId = 'retry-album';
  await queue.writePhotoQueue({ id, albumId, name: 'photo.webp', caption: 'my photo', prepared: new Blob(['photo'], { type: 'image/webp' }), filename: 'photo.webp', status: 'queued', createdAt: 2 });
  let uploads = 0;
  let saves = 0;
  let previews = 0;
  let published = 0;
  let live = false;
  const photoUrl = '/uploads/photos/retry-album/photo.webp';
  globalThis.fetch = async (url) => {
    if (url === '/api/admin/upload') { uploads++; return Response.json({ url: photoUrl }); }
    if (url.startsWith('/api/admin/publication')) return Response.json({ urls: live ? [photoUrl] : [] });
    if (url.startsWith(photoUrl)) return new Response(null, { status: 200 });
    return Response.json({ authenticated: true });
  };
  const props = {
    albumId,
    onSave: async () => { saves++; if (saves === 1) throw new Error('simulated album failure'); },
    onPreview: () => { previews++; },
    onPublished: () => { published++; },
    onRestore: () => {},
    onBusy: () => {},
  };
  await mount(React.createElement(editor.AdminEditModeProvider, null, React.createElement(uploader, props)));
  await React.act(tick);
  await click(button('上传并保存待处理照片'));
  assert.match(document.body.textContent, /simulated album failure/);
  assert.equal(uploads, 1);
  await click(button('重试这张'));
  assert.equal(uploads, 1, 'retry reuses the uploaded URL');
  assert.equal(saves, 2);
  assert.equal(previews, 1);
  assert.equal(published, 0);
  assert.equal((await queue.readPhotoQueue(albumId))[0].status, 'saved');
  assert.ok((await queue.readPhotoQueue(albumId))[0].prepared, 'preview bytes retained while deployment is pending');
  live = true;
  await click(button('检查发布状态'));
  assert.equal(published, 1);
  assert.equal((await queue.readPhotoQueue(albumId))[0].status, 'published');
  assert.equal((await queue.readPhotoQueue(albumId))[0].prepared, undefined);
  await unmount();
  await queue.writePhotoQueue(id);
});

test('upload and publication routes require an administrator', async () => {
  mocks.set('@/lib/admin/auth', { requireAdmin: async () => { throw new Response('Unauthorized', { status: 401 }); } });
  const upload = load('app/api/admin/upload/route.ts');
  const publication = load('app/api/admin/publication/route.ts');
  assert.equal((await upload.POST(new Request('https://site.test/api/admin/upload', { method: 'POST' }))).status, 401);
  assert.equal((await publication.GET(new Request('https://site.test/api/admin/publication?albumId=a'))).status, 401);
});

test('album controls preserve an explicit cover, reorder photos, and deduplicate retries', async () => {
  const original = { id: 'controls', title: 'Controls Album', date: '2026', description: '', cover: '/b.png', photos: [{ url: '/a.png', caption: 'A' }, { url: '/b.png', caption: 'B' }] };
  let remote = structuredClone(original);
  let puts = 0;
  mocks.set('../../data/albums', { albums: [original] });
  mocks.set('../../components/Navbar', { __esModule: true, default: () => null });
  mocks.set('../../components/PageTransition', { __esModule: true, default: ({ children }) => children });
  mocks.set('../../components/AdminCollectionManager', { __esModule: true, default: () => null });
  mocks.set('../../components/AlbumPhotoUploader', { __esModule: true, default: ({ onSave }) => React.createElement('button', { onClick: () => onSave({ url: '/new.png', caption: 'New' }) }, 'Test add photo') });
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/admin/session') return Response.json({ authenticated: true });
    if (options.method === 'PUT') { puts++; remote = JSON.parse(options.body).value; return Response.json({ sha: 'new' }); }
    return Response.json({ items: [remote], sha: 'old' });
  };
  window.history.replaceState({}, '', '/photowall?edit=1');
  const wall = load('app/photowall/PhotoWallClient.tsx').default;
  await mount(React.createElement(editor.AdminEditModeProvider, null, React.createElement(wall)));
  await click(document.querySelector('img[alt="Controls Album"]'));
  await click(button('设为封面'));
  assert.equal(remote.cover, '/a.png');
  assert.equal(remote.coverMode, 'manual');
  await click(button('Test add photo'));
  assert.equal(remote.cover, '/a.png', 'adding another photo preserves chosen cover');
  const afterFirst = puts;
  await click(button('Test add photo'));
  assert.equal(remote.photos.length, 3);
  assert.equal(puts, afterFirst, 'lost-response retry does not create another album commit');
  await click(button('后移'));
  assert.deepEqual(remote.photos.map((photo) => photo.url), ['/b.png', '/a.png', '/new.png']);
  await unmount();
});
