import type { AdminUser, AuthSession } from '@trip-planner/shared-types';
import { ApiError, api } from './apiClient';

/**
 * Legacy: checked whether Supabase env was filled in. We now talk to our own
 * backend; the API client always has a baseUrl (falls back to window.location.origin).
 * Kept so callers don't break, but it always returns true.
 */
export function isSupabaseConfigured(): boolean {
  return true;
}

/** Map a thrown error into a Chinese message for the login screen. */
export function describeSignInError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '帳號或密碼錯誤';
    if (error.status === 429) return '登入嘗試次數過多，請稍後再試。';
    if (error.status === 0 || error.status >= 500) return '伺服器暫時無法連線，請稍後再試。';
    if (error.message) return error.message;
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return '無法連線到伺服器，請檢查網路連線或 VITE_API_BASE_URL 設定。';
  }
  if (error instanceof Error && error.message) return error.message;
  return '登入失敗，請稍後再試。';
}

/**
 * Legacy Supabase return shape: { id, email?, created_at }. Map the camelCase
 * AdminUser from the API back to snake_case so existing UI components (e.g.
 * AccountManagement.tsx) keep rendering without edits.
 */
interface LegacyAdminUser {
  id: string;
  email?: string;
  created_at: string;
}

function toLegacyAdminUser(u: AdminUser): LegacyAdminUser {
  return { id: u.id, email: u.email, created_at: u.createdAt };
}

export async function signIn(email: string, password: string) {
  return api.login(email, password);
}

export async function signOut() {
  await api.logout();
}

/**
 * Returns a session-like object (or null) for legacy call sites that only
 * check truthiness. The cookie itself lives in httpOnly storage and is not
 * readable from JS — this call asks the server whether the cookie is valid.
 */
export async function getSession(): Promise<AuthSession | null> {
  try {
    const session = await api.getSession();
    if (!session) return null;
    return { user: session.user, expiresAt: session.expiresAt };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    return null;
  }
}

export async function listUsers(): Promise<LegacyAdminUser[]> {
  const users = await api.listAdminUsers();
  return users.map(toLegacyAdminUser);
}

export async function createUser(email: string, password: string): Promise<LegacyAdminUser> {
  const user = await api.createAdminUser(email, password);
  return toLegacyAdminUser(user);
}

export async function updateUserPassword(
  userId: string,
  password: string,
): Promise<LegacyAdminUser> {
  const user = await api.updateAdminUserPassword(userId, password);
  return toLegacyAdminUser(user);
}

export async function deleteUser(userId: string): Promise<void> {
  await api.deleteAdminUser(userId);
}
