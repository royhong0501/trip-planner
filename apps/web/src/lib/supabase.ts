/**
 * Legacy shim. The monorepo no longer talks to Supabase — everything goes through
 * the self-hosted API at VITE_API_BASE_URL via `@/lib/apiClient`.
 *
 * This file is kept only so that old imports (`import { supabase } from '@/lib/supabase'`)
 * fail loudly at runtime rather than silently returning mock data like the previous
 * placeholder client used to. If you see the error below, migrate the caller to `api`.
 */

function forbid(): never {
  throw new Error(
    "`supabase` is no longer available — replace this call with `api` from '@/lib/apiClient'.",
  );
}

export const supabase = new Proxy(
  {},
  {
    get: forbid,
    apply: forbid,
    construct: forbid,
  },
) as never;
