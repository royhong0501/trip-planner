import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  SITE_NAME_STORAGE_KEY,
  DEFAULT_ADMIN_DISPLAY,
  DEFAULT_PUBLIC_DOCUMENT_TITLE,
  fetchSiteNameFromSupabase,
} from '@/lib/siteName';

function computeTitle(pathname: string, siteName: string | null): string {
  const trimmed = siteName?.trim() || null;
  const isAdmin = pathname.startsWith('/admin');
  if (isAdmin) {
    return trimmed ? `${trimmed} · 後台` : DEFAULT_ADMIN_DISPLAY;
  }
  return trimmed || DEFAULT_PUBLIC_DOCUMENT_TITLE;
}

/**
 * 將 document.title 與後台「網站名稱」同步；後台路由加「· 後台」後綴。
 */
export function useSyncDocumentTitle(): void {
  const { pathname } = useLocation();
  const [siteName, setSiteName] = useState<string | null>(() => {
    const local = localStorage.getItem(SITE_NAME_STORAGE_KEY)?.trim();
    return local || null;
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const remote = await fetchSiteNameFromSupabase();
      if (cancelled) return;
      if (remote) {
        localStorage.setItem(SITE_NAME_STORAGE_KEY, remote);
        setSiteName(remote);
      } else {
        localStorage.removeItem(SITE_NAME_STORAGE_KEY);
        setSiteName(null);
      }
    };

    load();

    const onUpdated = (e: Event) => {
      const name = (e as CustomEvent<{ name: string }>).detail?.name;
      if (name === undefined) return;
      const t = name.trim();
      if (t) {
        localStorage.setItem(SITE_NAME_STORAGE_KEY, t);
        setSiteName(t);
      } else {
        localStorage.removeItem(SITE_NAME_STORAGE_KEY);
        setSiteName(null);
      }
    };

    window.addEventListener('siteNameUpdated', onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('siteNameUpdated', onUpdated);
    };
  }, []);

  useEffect(() => {
    document.title = computeTitle(pathname, siteName);
  }, [pathname, siteName]);
}
