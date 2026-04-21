import { useState, useEffect } from 'react';
import {
  SITE_NAME_STORAGE_KEY,
  DEFAULT_ADMIN_DISPLAY,
  fetchSiteNameFromSupabase,
} from '@/lib/siteName';

export { SITE_NAME_STORAGE_KEY } from '@/lib/siteName';

export function useSiteDisplayTitle(): string {
  const [title, setTitle] = useState(() => {
    const local = localStorage.getItem(SITE_NAME_STORAGE_KEY);
    if (local?.trim()) return local.trim();
    return DEFAULT_ADMIN_DISPLAY;
  });

  useEffect(() => {
    const fetchName = async () => {
      const remote = await fetchSiteNameFromSupabase();
      if (remote) {
        setTitle(remote);
        localStorage.setItem(SITE_NAME_STORAGE_KEY, remote);
      } else {
        setTitle(DEFAULT_ADMIN_DISPLAY);
        localStorage.removeItem(SITE_NAME_STORAGE_KEY);
      }
    };

    const onUpdated = (e: Event) => {
      const name = (e as CustomEvent<{ name: string }>).detail?.name;
      if (name === undefined) return;
      const trimmed = name.trim();
      if (trimmed) {
        localStorage.setItem(SITE_NAME_STORAGE_KEY, trimmed);
        setTitle(trimmed);
      } else {
        localStorage.removeItem(SITE_NAME_STORAGE_KEY);
        setTitle(DEFAULT_ADMIN_DISPLAY);
      }
    };

    fetchName();
    window.addEventListener('siteNameUpdated', onUpdated);
    return () => window.removeEventListener('siteNameUpdated', onUpdated);
  }, []);

  return title;
}
