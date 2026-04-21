export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthSession {
  user: AdminUser;
  /** ISO timestamp when the access token expires. */
  expiresAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: AdminUser;
  expiresAt: string;
}

/** Admin user mgmt responses (replaces Supabase admin-auth Edge Function). */
export interface ListAdminUsersResponse {
  users: AdminUser[];
}

export interface CreateAdminUserRequest {
  email: string;
  password: string;
}

export interface CreateAdminUserResponse {
  user: AdminUser;
}

export interface UpdateAdminUserPasswordRequest {
  userId: string;
  password: string;
}
