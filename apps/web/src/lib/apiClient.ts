import { createApiClient, ApiError } from '@trip-planner/api-client';

const baseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || window.location.origin;

export const api = createApiClient({ baseUrl, credentials: 'include' });
export { ApiError };
