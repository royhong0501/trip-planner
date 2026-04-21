import type {
  AdminUser,
  CreateExpensePayload,
  CreateExpenseSplitPayload,
  Expense,
  ExpenseWithSplits,
  GeoCityHit,
  HomepageSettingEntry,
  LoginResponse,
  TodoItem,
  Trip,
  TripParticipant,
  TripSummary,
  WeatherBundle,
} from '@trip-planner/shared-types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Forwarded to every fetch; defaults to 'include' so the admin session cookie is sent. */
  credentials?: RequestCredentials;
  /** Extra static headers (e.g., CSRF token). */
  headers?: Record<string, string>;
  /** Override for tests. */
  fetch?: typeof fetch;
}

export interface ApiClient {
  // --- Trips ---
  listTrips(): Promise<TripSummary[]>;
  getTrip(id: string): Promise<Trip | null>;
  createTrip(trip: Trip): Promise<Trip>;
  updateTrip(trip: Trip): Promise<Trip>;
  updateTripLists(
    id: string,
    payload: { luggageList: Trip['luggageList']; shoppingList: Trip['shoppingList'] },
  ): Promise<void>;
  deleteTrip(id: string): Promise<void>;

  // --- Todos (on trip row + dedicated table) ---
  patchTripTodos(
    tripId: string,
    body: { op: TodoPatchOp } | { replace: TodoItem[] },
  ): Promise<TodoItem[]>;
  insertTodoRow(tripId: string, todo: TodoItem): Promise<void>;
  deleteTodoRow(todoId: string): Promise<void>;

  // --- Participants ---
  getTripParticipants(tripId: string): Promise<TripParticipant[]>;
  addTripParticipant(
    tripId: string,
    body: { displayName: string; email?: string | null },
  ): Promise<TripParticipant>;
  deleteTripParticipant(participantId: string): Promise<void>;

  // --- Expenses ---
  getExpensesByTripId(tripId: string): Promise<ExpenseWithSplits[]>;
  createExpense(
    expense: CreateExpensePayload,
    splits: CreateExpenseSplitPayload[],
  ): Promise<ExpenseWithSplits>;
  updateExpense(expense: Expense): Promise<Expense>;
  deleteExpense(expenseId: string): Promise<void>;

  // --- Weather ---
  fetchWeather(params: {
    lat: number;
    lon: number;
    lang?: string;
    label?: string;
  }): Promise<WeatherBundle | null>;
  geocodeCity(q: string, limit?: number): Promise<GeoCityHit[]>;

  // --- Auth ---
  login(email: string, password: string): Promise<LoginResponse>;
  logout(): Promise<void>;
  getSession(): Promise<LoginResponse | null>;

  // --- Admin users ---
  listAdminUsers(): Promise<AdminUser[]>;
  createAdminUser(email: string, password: string): Promise<AdminUser>;
  updateAdminUserPassword(userId: string, password: string): Promise<AdminUser>;
  deleteAdminUser(userId: string): Promise<void>;

  // --- Homepage settings ---
  getHomepageSetting<T = unknown>(key: string): Promise<HomepageSettingEntry<T> | null>;
  setHomepageSetting<T = unknown>(key: string, value: T): Promise<HomepageSettingEntry<T>>;

  // --- Uploads ---
  createCoverPresign(body: {
    kind?: 'cover' | 'hero' | 'activity' | 'homepage';
    contentType: string;
    size: number;
  }): Promise<{ uploadUrl: string; publicUrl: string; key: string }>;
}

export type TodoPatchOp =
  | { type: 'add'; todo: TodoItem }
  | { type: 'update'; id: string; patch: Partial<TodoItem> }
  | { type: 'toggle'; id: string; checked: boolean }
  | { type: 'remove'; id: string };

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const fetchImpl = options.fetch ?? fetch;
  const credentials = options.credentials ?? 'include';
  const extraHeaders = options.headers ?? {};

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    init?: { query?: Record<string, string | number | undefined>; signal?: AbortSignal },
  ): Promise<T> {
    const url = new URL(baseUrl + path);
    if (init?.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetchImpl(url.toString(), {
      method,
      credentials,
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: init?.signal,
    });

    if (res.status === 204) return undefined as T;

    const ct = res.headers.get('content-type') ?? '';
    const parsed: unknown = ct.includes('application/json') ? await res.json() : await res.text();

    if (!res.ok) {
      const message =
        (parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
          ? (parsed as { error: string }).error
          : undefined) ?? res.statusText ?? 'Request failed';
      throw new ApiError(res.status, message, parsed);
    }
    return parsed as T;
  }

  return {
    listTrips: () => request<TripSummary[]>('GET', '/api/trips'),
    getTrip: (id) => request<Trip | null>('GET', `/api/trips/${encodeURIComponent(id)}`),
    createTrip: (trip) => request<Trip>('POST', '/api/trips', trip),
    updateTrip: (trip) =>
      request<Trip>('PATCH', `/api/trips/${encodeURIComponent(trip.id)}`, trip),
    updateTripLists: (id, payload) =>
      request<void>('PATCH', `/api/trips/${encodeURIComponent(id)}/lists`, payload),
    deleteTrip: (id) => request<void>('DELETE', `/api/trips/${encodeURIComponent(id)}`),

    patchTripTodos: (tripId, body) =>
      request<TodoItem[]>('PATCH', `/api/trips/${encodeURIComponent(tripId)}/todos`, body),
    insertTodoRow: (tripId, todo) =>
      request<void>('POST', `/api/trips/${encodeURIComponent(tripId)}/todos`, todo),
    deleteTodoRow: (todoId) =>
      request<void>('DELETE', `/api/todos/${encodeURIComponent(todoId)}`),

    getTripParticipants: (tripId) =>
      request<TripParticipant[]>('GET', `/api/trips/${encodeURIComponent(tripId)}/participants`),
    addTripParticipant: (tripId, body) =>
      request<TripParticipant>('POST', `/api/trips/${encodeURIComponent(tripId)}/participants`, body),
    deleteTripParticipant: (participantId) =>
      request<void>('DELETE', `/api/participants/${encodeURIComponent(participantId)}`),

    getExpensesByTripId: (tripId) =>
      request<ExpenseWithSplits[]>('GET', `/api/trips/${encodeURIComponent(tripId)}/expenses`),
    createExpense: (expense, splits) =>
      request<ExpenseWithSplits>('POST', '/api/expenses', { ...expense, splits }),
    updateExpense: (expense) =>
      request<Expense>('PATCH', `/api/expenses/${encodeURIComponent(expense.id)}`, expense),
    deleteExpense: (expenseId) =>
      request<void>('DELETE', `/api/expenses/${encodeURIComponent(expenseId)}`),

    fetchWeather: ({ lat, lon, lang = 'zh_tw', label }) =>
      request<WeatherBundle | null>('GET', '/api/weather', undefined, {
        query: { lat, lon, lang, label },
      }),
    geocodeCity: (q, limit) =>
      request<GeoCityHit[]>('GET', '/api/weather/geocode', undefined, { query: { q, limit } }),

    login: (email, password) => request<LoginResponse>('POST', '/api/auth/login', { email, password }),
    logout: () => request<void>('POST', '/api/auth/logout'),
    getSession: () => request<LoginResponse | null>('GET', '/api/auth/me'),

    listAdminUsers: () => request<AdminUser[]>('GET', '/api/admin/users'),
    createAdminUser: (email, password) =>
      request<AdminUser>('POST', '/api/admin/users', { email, password }),
    updateAdminUserPassword: (userId, password) =>
      request<AdminUser>('PATCH', `/api/admin/users/${encodeURIComponent(userId)}/password`, {
        password,
      }),
    deleteAdminUser: (userId) =>
      request<void>('DELETE', `/api/admin/users/${encodeURIComponent(userId)}`),

    getHomepageSetting: <T>(key: string) =>
      request<HomepageSettingEntry<T> | null>(
        'GET',
        `/api/homepage-settings/${encodeURIComponent(key)}`,
      ),
    setHomepageSetting: <T>(key: string, value: T) =>
      request<HomepageSettingEntry<T>>('PATCH', `/api/homepage-settings/${encodeURIComponent(key)}`, {
        value,
      }),

    createCoverPresign: (body) =>
      request<{ uploadUrl: string; publicUrl: string; key: string }>(
        'POST',
        '/api/uploads/cover',
        body,
      ),
  };
}
