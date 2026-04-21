import { api } from './apiClient';

export const SITE_NAME_STORAGE_KEY = 'siteName';

/** Back-office sidebar placeholder while the remote name is loading. */
export const DEFAULT_ADMIN_DISPLAY = '後台管理';

/** Default document.title on public pages when no site name is set (matches index.html). */
export const DEFAULT_PUBLIC_DOCUMENT_TITLE = '旅遊規劃';

/**
 * Legacy name kept for call sites; now reads from the self-hosted
 * `homepage_settings` endpoint instead of Supabase.
 */
export async function fetchSiteNameFromSupabase(): Promise<string | null> {
  try {
    const entry = await api.getHomepageSetting<string>('site_name');
    const v = entry?.value;
    if (typeof v === 'string' && v.trim()) return v.trim();
    return null;
  } catch {
    return null;
  }
}
