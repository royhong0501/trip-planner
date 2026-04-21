import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Plane, Hotel, Luggage, ShoppingCart, Users, Receipt, X, ExternalLink, Check, Clock, Trash2, Image, ChevronRight, MapPin } from 'lucide-react';
import { Trip, ActivityCard as ActivityCardType, TodoItem, LuggageCategory, ShoppingItem } from '@/types/trip';
import Header from '@/components/Header';
import ActivityDetailModal from '@/components/trip/ActivityDetailModal';
import LuggageModal from '@/components/trip/LuggageModal';
import ShoppingModal from '@/components/trip/ShoppingModal';
import ManageParticipants from '@/components/trip/ManageParticipants';
import ExpenseLedgerModal from '@/components/trip/ExpenseLedgerModal';
import TripWeatherSidebar from '@/components/trip/TripWeatherSidebar';
import { fetchTripById, updateTrip, updateTripLists, insertTodoRow, deleteTodoRow, patchTripTodos } from '@/lib/trips';
import { getTripParticipants } from '@/lib/expenses';
import type { TripParticipant } from '@/types/expense';
import { toast } from 'sonner';
import {
  buildTodoDateTimeFields,
  formatDateTimeZhTw,
  NO_REMINDER_MINUTES,
  remindOffsetOptions,
} from '@/lib/todoReminders';

const TripDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: trip, isLoading, isError } = useQuery({
    queryKey: ['trip', id],
    queryFn: () => fetchTripById(id!),
    enabled: !!id,
  });

  const { data: participants = [] } = useQuery<TripParticipant[]>({
    queryKey: ['participants', id],
    queryFn: () => getTripParticipants(id!),
    enabled: !!id,
  });

  const mutation = useMutation({
    mutationFn: updateTrip,
    onSuccess: (updatedTrip) => {
      queryClient.setQueryData<Trip>(['trip', id], (old) =>
        old
          ? { ...updatedTrip, shoppingList: old.shoppingList, luggageList: old.luggageList }
          : updatedTrip
      );
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (e: Error) => {
      toast.error(e.message || '儲存失敗，請確認已登入後台帳號');
    },
  });

  const listsMutation = useMutation({
    mutationFn: ({ luggageList, shoppingList }: { luggageList: LuggageCategory[]; shoppingList: ShoppingItem[] }) =>
      updateTripLists(id!, luggageList, shoppingList),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (e: Error) => {
      toast.error(e.message || '清單儲存失敗，請確認已登入後台帳號');
      queryClient.invalidateQueries({ queryKey: ['trip', id] });
    },
  });

  const [selectedActivity, setSelectedActivity] = useState<ActivityCardType | null>(null);
  const [luggageOpen, setLuggageOpen] = useState(false);
  const [shoppingOpen, setShoppingOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [newTodo, setNewTodo] = useState('');
  const [newTodoDueAt, setNewTodoDueAt] = useState('');
  const [newTodoRemindOffsetMinutes, setNewTodoRemindOffsetMinutes] = useState<number>(NO_REMINDER_MINUTES);
  const [showTodoInput, setShowTodoInput] = useState(false);
  const [newTodoParticipantId, setNewTodoParticipantId] = useState('');
  const [isTodoExpanded, setIsTodoExpanded] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (trip) {
      setTodos(trip.todos);
    }
  }, [trip]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const latest = queryClient.getQueryData<Trip>(['trip', id]);
      if (latest) listsMutation.mutate({ luggageList: latest.luggageList, shoppingList: latest.shoppingList });
      saveTimerRef.current = null;
    }, 600);
  }, [queryClient, id, listsMutation]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const latest = queryClient.getQueryData<Trip>(['trip', id]);
      if (latest) listsMutation.mutate({ luggageList: latest.luggageList, shoppingList: latest.shoppingList });
    }
  }, [queryClient, id, listsMutation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">載入中...</p>
      </div>
    );
  }

  if (isError || !trip) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">找不到此行程</p>
      </div>
    );
  }

  const toggleTodo = (todoId: string) => {
    const next = todos.map((t) => (t.id === todoId ? { ...t, checked: !t.checked } : t));
    setTodos(next);
    const toggled = next.find((t) => t.id === todoId);
    patchTripTodos(trip.id, (fresh) =>
      fresh.map((t) => (t.id === todoId ? { ...t, checked: toggled?.checked ?? !t.checked } : t)),
    )
      .then((merged) => {
        queryClient.setQueryData<Trip>(['trip', id], (old) => (old ? { ...old, todos: merged } : old));
        queryClient.invalidateQueries({ queryKey: ['trips'] });
      })
      .catch((e: Error) => toast.error(e.message || '待辦更新失敗'));
    if (toggled?.checked) {
      console.log(`[TripDetail] toggleTodo: 勾選完成，刪除提醒 todoId=${todoId}`);
      void deleteTodoRow(todoId).catch((e) => console.error('[TripDetail] todos table delete failed', e));
    } else if (toggled?.remindTime) {
      console.log(`[TripDetail] toggleTodo: 取消勾選且有 remindTime，重新插入 todoId=${todoId}`);
      void insertTodoRow(trip.id, toggled).catch((e) => console.error('[TripDetail] todos table insert failed', e));
    } else {
      console.log(`[TripDetail] toggleTodo: 取消勾選但無 remindTime，不寫 todos 表 todoId=${todoId}`);
    }
  };

  const resetTodoForm = () => {
    setNewTodo('');
    setNewTodoDueAt('');
    setNewTodoRemindOffsetMinutes(NO_REMINDER_MINUTES);
    setNewTodoParticipantId('');
  };

  const addTodo = () => {
    if (!newTodo.trim()) return;
    const { dueAt, remindTime, remindOffset } = buildTodoDateTimeFields(
      newTodoDueAt,
      newTodoRemindOffsetMinutes
    );
    const newTodoItem = {
      id: crypto.randomUUID(),
      text: newTodo.trim(),
      checked: false,
      dueAt,
      remindTime,
      remindOffset,
      assignedParticipantId: newTodoParticipantId || null,
    };
    const next = [...todos, newTodoItem];
    setTodos(next);
    resetTodoForm();
    setShowTodoInput(false);
    console.log(`[TripDetail] addTodo: 新增 todo="${newTodoItem.text}" remindTime=${newTodoItem.remindTime ?? '無'}`);
    patchTripTodos(trip.id, (fresh) => [...fresh, newTodoItem])
      .then((merged) => {
        queryClient.setQueryData<Trip>(['trip', id], (old) => (old ? { ...old, todos: merged } : old));
        queryClient.invalidateQueries({ queryKey: ['trips'] });
      })
      .catch((e: Error) => toast.error(e.message || '待辦新增失敗'));
    void insertTodoRow(trip.id, newTodoItem).catch((e) => console.error('[TripDetail] todos table insert failed', e));
  };

  const removeTodo = (todoId: string) => {
    const next = todos.filter((t) => t.id !== todoId);
    setTodos(next);
    console.log(`[TripDetail] removeTodo: 刪除 todoId=${todoId}`);
    patchTripTodos(trip.id, (fresh) => fresh.filter((t) => t.id !== todoId))
      .then((merged) => {
        queryClient.setQueryData<Trip>(['trip', id], (old) => (old ? { ...old, todos: merged } : old));
        queryClient.invalidateQueries({ queryKey: ['trips'] });
      })
      .catch((e: Error) => toast.error(e.message || '待辦刪除失敗'));
    void deleteTodoRow(todoId).catch((e) => console.error('[TripDetail] todos table delete failed', e));
  };

  const handleLuggageUpdate = (next: LuggageCategory[]) => {
    queryClient.setQueryData<Trip>(['trip', id], (old) =>
      old ? { ...old, luggageList: next } : old
    );
    scheduleSave();
  };

  const handleShoppingUpdate = (next: ShoppingItem[]) => {
    queryClient.setQueryData<Trip>(['trip', id], (old) =>
      old ? { ...old, shoppingList: next } : old
    );
    scheduleSave();
  };

  const renderAddress = (address: string) => {
    if (!address) return null;
    const href = address.startsWith('http')
      ? address
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-1.5 rounded-md bg-secondary/10 text-secondary text-xs font-medium hover:bg-secondary/20 active:bg-secondary/30 transition-colors"
      >
        <MapPin className="h-3 w-3 shrink-0" /> 前往地圖
      </a>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Cover */}
      <div className="relative">
        {trip.coverImage ? (
          <img src={trip.coverImage} alt={trip.title} className="w-full h-64 md:h-96 object-cover" />
        ) : (
          <div
            className="w-full h-64 md:h-96 bg-muted flex items-center justify-center"
            aria-hidden
          >
            <Image className="h-20 w-20 text-muted-foreground/40" />
          </div>
        )}
        <div className="absolute inset-0 bg-hero-overlay" />
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-primary/50 text-white flex items-center justify-center hover:bg-primary/70 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="absolute bottom-6 left-6 md:left-12">
          <h1 className="text-2xl md:text-4xl font-bold text-white drop-shadow-lg">{trip.title}</h1>
          <p className="text-white/85 mt-1">{trip.startDate} ~ {trip.endDate}</p>
        </div>
      </div>

      <div className="container mx-auto min-w-0 max-w-full px-4 py-8">
        <div className="min-w-0 space-y-10">
          <TripWeatherSidebar
            weatherCities={trip.weatherCities ?? []}
            onWeatherCitiesChange={(next) => mutation.mutate({ ...trip, weatherCities: next })}
          />

        {/* 採購清單、記帳器（天氣追蹤下方） */}
        <div className="grid grid-cols-2 gap-4 sm:gap-6">
          <button
            type="button"
            onClick={() => setShoppingOpen(true)}
            className="bg-card rounded-xl p-4 md:p-8 shadow-sm hover:shadow-md transition-shadow flex flex-col items-center gap-2 md:gap-3 group"
          >
            <ShoppingCart className="h-7 w-7 md:h-10 md:w-10 text-secondary group-hover:scale-110 transition-transform" />
            <span className="text-sm md:text-base font-medium text-foreground">採購清單</span>
          </button>
          <button
            type="button"
            onClick={() => setLedgerOpen(true)}
            className="bg-card rounded-xl p-4 md:p-8 shadow-sm hover:shadow-md transition-shadow flex flex-col items-center gap-2 md:gap-3 group"
          >
            <Receipt className="h-7 w-7 md:h-10 md:w-10 text-secondary group-hover:scale-110 transition-transform" />
            <span className="text-sm md:text-base font-medium text-foreground">記帳器</span>
          </button>
        </div>

        {/* Todos */}
        <div className="bg-card rounded-xl p-6 shadow-sm">
          <button
            type="button"
            onClick={() => setIsTodoExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between text-left"
            aria-expanded={isTodoExpanded}
            aria-label={isTodoExpanded ? '收合待辦事項' : '展開待辦事項'}
          >
            <h3 className="font-semibold text-foreground">待辦事項</h3>
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform ${isTodoExpanded ? 'rotate-90' : ''}`}
            />
          </button>
          {isTodoExpanded && (
            <div className="space-y-2 mt-4">
              {todos.map((todo) => (
                (() => {
                  const anchorIso = todo.remindTime ?? todo.dueAt ?? null;
                  const anchorMs = anchorIso ? Date.parse(anchorIso) : NaN;
                  const isExpired = !todo.checked && Number.isFinite(anchorMs) && anchorMs <= nowMs;
                  const isSoon =
                    !todo.checked &&
                    Number.isFinite(anchorMs) &&
                    anchorMs > nowMs &&
                    anchorMs <= nowMs + 60 * 60_000;

                  return (
                    <div
                      key={todo.id}
                      className={`flex items-center gap-3 group rounded-lg p-2 ${isExpired ? 'bg-muted/40' : 'bg-transparent'}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleTodo(todo.id)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          todo.checked ? 'bg-secondary border-secondary' : 'border-border hover:border-secondary'
                        }`}
                        aria-label={todo.checked ? '標為未完成' : '標為完成'}
                      >
                        {todo.checked && <Check className="h-3 w-3 text-secondary-foreground" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleTodo(todo.id)}
                        className="min-w-0 flex-1 text-left flex flex-col cursor-pointer"
                      >
                        <span className={`text-sm ${todo.checked ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                          {todo.text}
                        </span>
                        {todo.dueAt && (
                          <span
                            className={`text-xs mt-0.5 ${todo.checked ? 'text-muted-foreground/70' : 'text-muted-foreground'} flex items-center gap-1 flex-wrap`}
                          >
                            {isSoon && <Clock className="h-3.5 w-3.5 animate-pulse text-amber-500 shrink-0" />}
                            <span>{formatDateTimeZhTw(todo.dueAt)}</span>
                          </span>
                        )}
                        {todo.remindTime && (
                          <span className={`text-xs mt-0.5 ${todo.checked ? 'text-muted-foreground/70' : 'text-muted-foreground'} flex items-center gap-1`}>
                            <span>提醒：{formatDateTimeZhTw(todo.remindTime)}</span>
                          </span>
                        )}
                        {todo.assignedParticipantId && (() => {
                          const p = participants.find((x) => x.id === todo.assignedParticipantId);
                          return p ? (
                            <span className={`text-xs mt-0.5 ${todo.checked ? 'text-muted-foreground/70' : 'text-secondary'} flex items-center gap-1`}>
                              <Users className="h-3 w-3 shrink-0" />
                              <span>{p.displayName}</span>
                            </span>
                          ) : null;
                        })()}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTodo(todo.id)}
                        className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        aria-label="刪除待辦"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })()
              ))}
              {showTodoInput ? (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-2">
                  <input
                    autoFocus
                    value={newTodo}
                    onChange={(e) => setNewTodo(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTodo()}
                    placeholder="輸入待辦事項..."
                    className="w-full sm:flex-1 text-sm px-3 py-1.5 rounded-md border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="datetime-local"
                    value={newTodoDueAt}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNewTodoDueAt(v);
                      if (!v) setNewTodoRemindOffsetMinutes(NO_REMINDER_MINUTES);
                    }}
                    className="w-full sm:w-auto text-sm px-3 py-1.5 rounded-md border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
                  />
                  {newTodoDueAt ? (
                    <select
                      value={newTodoRemindOffsetMinutes}
                      onChange={(e) => setNewTodoRemindOffsetMinutes(Number(e.target.value))}
                      aria-label="提醒時間"
                      className="w-full sm:w-auto text-sm px-3 py-1.5 rounded-md border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
                    >
                      {remindOffsetOptions.map((opt) => (
                        <option key={opt.minutes} value={opt.minutes}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <select
                    value={newTodoParticipantId}
                    onChange={(e) => setNewTodoParticipantId(e.target.value)}
                    aria-label="指派成員"
                    className="w-full sm:w-auto text-sm px-3 py-1.5 rounded-md border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">不指派</option>
                    {participants.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={addTodo}
                    className="w-full sm:w-auto px-3 py-1.5 text-sm rounded-md bg-action text-action-foreground hover:bg-action/90"
                  >
                    新增
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetTodoForm();
                      setShowTodoInput(false);
                    }}
                    className="w-full sm:w-auto text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    resetTodoForm();
                    setShowTodoInput(true);
                  }}
                  className="flex items-center gap-1 text-sm text-muted-foreground/60 hover:text-secondary transition-colors mt-2"
                >
                  <Plus className="h-4 w-4" /> 新增待辦事項
                </button>
              )}
            </div>
          )}
        </div>

        {/* Flights & Hotels */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Flights */}
          <div className="bg-card rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Plane className="h-5 w-5 text-secondary" /> 航班資訊
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {(['departure', 'return'] as const).map((dir) => (
                <div key={dir}>
                  <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">{dir === 'departure' ? '去程' : '回程'}</p>
                  {trip.flights[dir].airline ? (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium text-foreground">{trip.flights[dir].airline} {trip.flights[dir].flightNumber}</p>
                      <p className="text-muted-foreground">{trip.flights[dir].departureAirport}</p>
                      <p className="text-muted-foreground">→ {trip.flights[dir].arrivalAirport}</p>
                      <p className="text-secondary font-medium">{trip.flights[dir].departureTime}</p>
                      {(trip.flights[dir].checkedBaggage > 0 || trip.flights[dir].carryOnBaggage > 0) && (
                        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                          {trip.flights[dir].checkedBaggage > 0 && <p>托運行李：{trip.flights[dir].checkedBaggage} Kg</p>}
                          {trip.flights[dir].carryOnBaggage > 0 && <p>隨身行李：{trip.flights[dir].carryOnBaggage} Kg</p>}
                        </div>
                      )}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">尚未設定</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Hotels */}
          <div className="bg-card rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Hotel className="h-5 w-5 text-secondary" /> 住宿資訊
            </h3>
            {trip.hotels.length === 0 ? (
              <p className="text-sm text-muted-foreground">尚未設定</p>
            ) : (
              <div className="space-y-3">
                {trip.hotels.map((hotel) => (
                  <div key={hotel.id} className="p-3 rounded-lg bg-muted/50">
                    <p className="font-medium text-foreground text-sm">{hotel.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{hotel.checkIn} ~ {hotel.checkOut}</p>
                    {hotel.address && (
                      <a
                        href={
                          hotel.address.startsWith('http')
                            ? hotel.address
                            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.address)}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-1.5 rounded-md bg-secondary/10 text-secondary text-xs font-medium hover:bg-secondary/20 active:bg-secondary/30 transition-colors"
                      >
                        <MapPin className="h-3 w-3 shrink-0" /> 前往地圖
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Daily Itineraries：橫向捲動區與標題分開 padding，避免內層 w-max 撐破外層寬度；勿用 touch-pan-x（會干擾頁面垂直捲動） */}
        <div className="bg-card rounded-xl py-6 shadow-sm min-w-0 max-w-full overflow-x-hidden">
          <h3 className="font-semibold text-foreground mb-4 px-6">每日行程</h3>
          {trip.dailyItineraries.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6">尚未設定行程</p>
          ) : (
            <div
              className="itinerary-x-scroll w-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2 pl-6 pr-6 [contain:inline-size]"
              tabIndex={0}
              aria-label="每日行程橫向捲動"
            >
              <div className="flex w-max flex-nowrap gap-6 pb-2">
                {trip.dailyItineraries.map((day) => (
                  <div key={day.date} className="w-64 shrink-0 min-w-0 max-w-64">
                    <div className="sticky top-0 bg-table-header text-table-header-foreground rounded-t-lg px-4 py-2 text-sm font-medium text-center">
                      {new Date(day.date).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit', weekday: 'short' })}
                    </div>
                    <div className="space-y-3 mt-3">
                      {day.activities.map((activity) => (
                        <button
                          key={activity.id}
                          onClick={() => setSelectedActivity(activity)}
                          className="w-full min-w-0 text-left bg-muted/50 rounded-lg overflow-hidden hover:shadow-md transition-shadow group"
                        >
                          <div className="p-3 min-w-0">
                            {activity.time && (
                              <p className="text-xs tabular-nums text-muted-foreground mb-0.5">{activity.time}</p>
                            )}
                            <p className="font-medium text-foreground text-sm truncate">{activity.title}</p>
                            <span className="inline-block max-w-full truncate mt-1 px-2 py-0.5 bg-secondary/20 text-secondary text-xs rounded-full">{activity.type}</span>
                            <div className="mt-1 min-w-0">{renderAddress(activity.address)}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 行李清單、行程成員（採購與記帳器已置頂） */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <button
            type="button"
            onClick={() => setLuggageOpen(true)}
            className="bg-card rounded-xl p-8 shadow-sm hover:shadow-md transition-shadow flex flex-col items-center gap-3 group"
          >
            <Luggage className="h-10 w-10 text-secondary group-hover:scale-110 transition-transform" />
            <span className="font-medium text-foreground">行李清單</span>
          </button>
          <button
            type="button"
            onClick={() => setParticipantsOpen(true)}
            className="bg-card rounded-xl p-8 shadow-sm hover:shadow-md transition-shadow flex flex-col items-center gap-3 group"
          >
            <Users className="h-10 w-10 text-secondary group-hover:scale-110 transition-transform" />
            <span className="font-medium text-foreground">行程成員</span>
          </button>
        </div>

        {/* Section 5: Other notes */}
        {trip.otherNotes && (
          <div className="bg-card rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold text-foreground mb-4">其他</h3>
            <div className="rich-html text-sm text-table-foreground" dangerouslySetInnerHTML={{ __html: trip.otherNotes }} />
          </div>
        )}
        </div>
      </div>

      {/* Modals */}
      {selectedActivity && (
        <ActivityDetailModal activity={selectedActivity} onClose={() => setSelectedActivity(null)} />
      )}
      <LuggageModal
        open={luggageOpen}
        onClose={() => { flushSave(); setLuggageOpen(false); }}
        tripId={trip.id}
        luggageList={trip.luggageList}
        onUpdate={handleLuggageUpdate}
      />
      <ShoppingModal
        open={shoppingOpen}
        onClose={() => { flushSave(); setShoppingOpen(false); }}
        tripId={trip.id}
        shoppingList={trip.shoppingList}
        onUpdate={handleShoppingUpdate}
      />
      <ManageParticipants tripId={trip.id} open={participantsOpen} onOpenChange={setParticipantsOpen} />
      <ExpenseLedgerModal tripId={trip.id} open={ledgerOpen} onOpenChange={setLedgerOpen} />
    </div>
  );
};

export default TripDetail;
