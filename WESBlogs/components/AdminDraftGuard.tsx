'use client';

import { useCallback, useEffect, useId, useState } from 'react';

const pending = new Map<string, { dirty: boolean; busy: boolean }>();
const memoryDrafts = new Map<string, string>();
const prefix = 'wes-admin-draft:v1:';

export function confirmAdminLeave(dirty?: boolean, busy?: boolean) {
  const entries = [...pending.values()];
  if (busy ?? entries.some((entry) => entry.busy)) {
    window.alert('正在保存，请等操作完成后再离开。');
    return false;
  }
  return !(dirty ?? entries.some((entry) => entry.dirty))
    || window.confirm('还有未保存的修改。离开后会保留草稿，重新打开编辑可继续。确定离开？');
}

export function useAdminPending(dirty: boolean, busy = false) {
  const id = useId();
  useEffect(() => {
    pending.set(id, { dirty, busy });
    return () => { pending.delete(id); };
  }, [id, dirty, busy]);
}

// Drafts stay in this tab's session. Unpublished text is never sent to a server.
export function useDraftStorage(key: string) {
  const [storageError, setStorageError] = useState(false);
  const storageKey = prefix + key;
  const read = useCallback((suffix = '') => {
    const fullKey = storageKey + ':' + suffix;
    try { return memoryDrafts.get(fullKey) ?? sessionStorage.getItem(fullKey); }
    catch { return memoryDrafts.get(fullKey) ?? null; }
  }, [storageKey]);
  const write = useCallback((value: string, suffix = '') => {
    const fullKey = storageKey + ':' + suffix;
    memoryDrafts.set(fullKey, value);
    try { sessionStorage.setItem(fullKey, value); setStorageError(false); }
    catch { setStorageError(true); }
  }, [storageKey]);
  const clear = useCallback((suffix = '') => {
    const fullKey = storageKey + ':' + suffix;
    memoryDrafts.delete(fullKey);
    try { sessionStorage.removeItem(fullKey); } catch { /* Memory is cleared. */ }
  }, [storageKey]);
  return { read, write, clear, storageError };
}

export function AdminNavigationGuard() {
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (![...pending.values()].some((entry) => entry.dirty || entry.busy)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const beforeLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href);
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (!confirmAdminLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeLink, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', beforeLink, true);
    };
  }, []);
  return null;
}
