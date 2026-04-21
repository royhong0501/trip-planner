import { useState, useRef, useEffect, useMemo, useCallback, Fragment, DragEvent } from 'react';
import { ArrowLeft, Plus, Trash2, Upload, GripVertical, Users, Luggage, ShoppingCart, Check, X, Clock, ChevronDown } from 'lucide-react';
import { Trip, DailyItinerary, ActivityCard, HotelInfo, LuggageCategory, ShoppingItem } from '@/types/trip';
import { hotelsCoveringDay } from '@/lib/hotels';
import LuggageModal from '@/components/trip/LuggageModal';
import ShoppingModal from '@/components/trip/ShoppingModal';
import TripExpensesPanel from '@/components/admin/TripExpensesPanel';
import ManageParticipants from '@/components/trip/ManageParticipants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { addDays, format, parseISO } from 'date-fns';
import {
  buildTodoDateTimeFields,
  formatDateTimeZhTw,
  NO_REMINDER_MINUTES,
  remindOffsetOptions,
} from '@/lib/todoReminders';
import { loadGoogleMapsApi } from '@/lib/googleMaps';
import { api } from '@/lib/apiClient';
import { insertTodoRow, deleteTodoRow, patchTripTodos } from '@/lib/trips';
import { getTripParticipants } from '@/lib/expenses';
import type { TripParticipant } from '@/types/expense';
import ItineraryMap, { type MapHandle, type RouteSegment } from '@/components/admin/ItineraryMap';
import PlacesAutocomplete from '@/components/admin/PlacesAutocomplete';
import type { PlaceData } from '@/components/admin/PlacesAutocomplete';
import { getDayColor } from '@/lib/dayColors';

interface Props {
  trip: Trip;
  onSave: (trip: Trip) => void;
  onCancel: () => void;
  isSaving?: boolean;
  /** 後台「新增行程」尚未儲存前為 true，記帳管理將暫時停用 */
  isNewTrip?: boolean;
}

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });

/** YYYY-MM-DD 純日曆加減：`parseISO` 對僅日期字串以本地日曆解析，搭配 `addDays`/`format` 避免原生 `Date` 與 `toISOString()` 混用。 */
const addCalendarDaysIso = (isoDate: string, days: number): string =>
  format(addDays(parseISO(isoDate.split('T')[0]), days), 'yyyy-MM-dd');

const TripEditor = ({ trip: initial, onSave, onCancel, isSaving = false, isNewTrip = false }: Props) => {
  const [trip, setTrip] = useState<Trip>({ ...initial });
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [luggageOpen, setLuggageOpen] = useState(false);
  const [shoppingOpen, setShoppingOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [showTodoInput, setShowTodoInput] = useState(false);
  const [newTodo, setNewTodo] = useState('');
  const [newTodoDueAt, setNewTodoDueAt] = useState('');
  const [newTodoRemindOffsetMinutes, setNewTodoRemindOffsetMinutes] = useState<number>(NO_REMINDER_MINUTES);
  const [newTodoParticipantId, setNewTodoParticipantId] = useState('');
  const [participants, setParticipants] = useState<TripParticipant[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  /** Day index whose markers are shown on the map; null = no markers */
  const [mapDayIdx, setMapDayIdx] = useState<number | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  /** Activity ID highlighted by clicking a map marker (Map → List). */
  const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
  /** Travel-time / distance info between consecutive activities (from Directions API). */
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  /** 飯店 origin → 第一個 activity 那段（由 ItineraryMap 回傳）；無則為 null */
  const [originSegment, setOriginSegment] = useState<RouteSegment | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  /**
   * Stable memoised activities array for the currently visible map day.
   * Without useMemo, a new array reference is created on every render,
   * which causes ItineraryMap's main effect to re-run and thrash Google Maps
   * objects — the root cause of the OOM crash in production.
   */
  const mapActivities = useMemo(
    () => mapDayIdx !== null ? (trip.dailyItineraries[mapDayIdx]?.activities ?? []) : [],
    [trip.dailyItineraries, mapDayIdx],
  );
  /** 當日被 checkIn~checkOut 覆蓋且有座標的飯店；傳給 ItineraryMap 畫 pin 與納入路線。 */
  const dayHotels = useMemo(() => {
    if (mapDayIdx === null) return [];
    const day = trip.dailyItineraries[mapDayIdx];
    return day ? hotelsCoveringDay(trip.hotels, day.date) : [];
  }, [trip.hotels, trip.dailyItineraries, mapDayIdx]);
  const dayDate = mapDayIdx !== null ? trip.dailyItineraries[mapDayIdx]?.date : undefined;
  /** Imperative handle to call panToActivity on the map. */
  const mapHandleRef = useRef<MapHandle | null>(null);
  /** DOM refs for each card so we can scrollIntoView on marker click. */
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setTrip((prev) => ({ ...prev, luggageList: initial.luggageList, shoppingList: initial.shoppingList }));
  }, [initial.luggageList, initial.shoppingList]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Fetch trip participants for todo assignee selector
  useEffect(() => {
    if (isNewTrip) return;
    getTripParticipants(trip.id).then(setParticipants).catch(() => {});
  }, [trip.id, isNewTrip]);

  // Load Google Maps API once on mount
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    if (!apiKey) return;
    loadGoogleMapsApi(apiKey).then(() => setMapsReady(true));
  }, []);

  // Drag state for activities
  const dragActivity = useRef<{ dayIdx: number; actIdx: number } | null>(null);
  const dragOverActivity = useRef<{ dayIdx: number; actIdx: number } | null>(null);

  const handleActivityDragStart = (dayIdx: number, actIdx: number) => {
    dragActivity.current = { dayIdx, actIdx };
  };

  const handleActivityDrop = (e: DragEvent) => {
    e.preventDefault();
    const from = dragActivity.current;
    const to = dragOverActivity.current;
    if (!from || !to) return;

    const updated = trip.dailyItineraries.map(d => ({ ...d, activities: [...d.activities] }));
    const [movedItem] = updated[from.dayIdx].activities.splice(from.actIdx, 1);
    updated[to.dayIdx].activities.splice(to.actIdx, 0, movedItem);
    update('dailyItineraries', updated);

    dragActivity.current = null;
    dragOverActivity.current = null;
  };

  const update = <K extends keyof Trip>(key: K, value: Trip[K]) => {
    setTrip((prev) => ({ ...prev, [key]: value }));
  };

  const toggleCard = (id: string, dayIdx: number) => {
    const isExpanding = !expandedCards.has(id);

    setExpandedCards((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setMapDayIdx(dayIdx);

    if (isExpanding) {
      // Highlight this activity (triggers segment-highlight effect in ItineraryMap)
      setActiveActivityId(id);
      // Also trigger BOUNCE / fallback panTo via imperative handle
      const act = trip.dailyItineraries[dayIdx]?.activities.find((a) => a.id === id);
      if (act?.lat && act?.lng) {
        mapHandleRef.current?.panToActivity(id);
      }
    }
  };

  const handlePlaceSelect = (dayIdx: number, actId: string, place: PlaceData) => {
    const updated = [...trip.dailyItineraries];
    updated[dayIdx] = {
      ...updated[dayIdx],
      activities: updated[dayIdx].activities.map((a) =>
        a.id !== actId
          ? a
          : { ...a, address: place.address, placeId: place.placeId, lat: place.lat, lng: place.lng }
      ),
    };
    update('dailyItineraries', updated);
    // Refresh map markers
    setMapDayIdx(dayIdx);
  };

  /**
   * Map → List: called when a map marker is clicked.
   * Wrapped in useCallback so the reference is stable across TripEditor
   * re-renders — this prevents React.memo on ItineraryMap from seeing a
   * changed `onMarkerClick` prop when unrelated state (e.g. typing in a
   * title field) updates.
   */
  const handleMarkerClick = useCallback((activityId: string) => {
    setActiveActivityId(activityId);
    // Ensure the card is expanded
    setExpandedCards((prev) => {
      if (prev.has(activityId)) return prev;
      return new Set([...prev, activityId]);
    });
    // Double rAF: first frame lets React commit the expanded state,
    // second frame ensures the browser has painted the new height.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cardRefs.current[activityId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }, []); // deps empty: only uses stable state setters + cardRefs

  const toggleTodo = (todoId: string) => {
    const next = trip.todos.map((t) => (t.id === todoId ? { ...t, checked: !t.checked } : t));
    update('todos', next);
    if (!isNewTrip) {
      const toggled = next.find((t) => t.id === todoId);
      // 即時寫回 DB，不等使用者按「儲存」；避免 editor 後續的 updateTrip 用舊快照覆寫
      void patchTripTodos(trip.id, (fresh) =>
        fresh.map((t) => (t.id === todoId ? { ...t, checked: toggled?.checked ?? !t.checked } : t)),
      ).catch((e) => console.error('[TripEditor] patchTripTodos toggle failed', e));
      if (toggled?.checked) {
        console.log(`[TripEditor] toggleTodo: 勾選完成，刪除提醒 todoId=${todoId}`);
        void deleteTodoRow(todoId).catch((e) => console.error('[TripEditor] todos table delete failed', e));
      } else if (toggled?.remindTime) {
        console.log(`[TripEditor] toggleTodo: 取消勾選且有 remindTime，重新插入 todoId=${todoId}`);
        void insertTodoRow(trip.id, toggled).catch((e) => console.error('[TripEditor] todos table insert failed', e));
      } else {
        console.log(`[TripEditor] toggleTodo: 取消勾選但無 remindTime，不寫 todos 表 todoId=${todoId}`);
      }
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
    const next = [...trip.todos, newTodoItem];
    update('todos', next);
    resetTodoForm();
    setShowTodoInput(false);
    console.log(`[TripEditor] addTodo: 新增 todo="${newTodoItem.text}" remindTime=${newTodoItem.remindTime ?? '無'}`);
    if (!isNewTrip) {
      // 即時寫回 DB（以 DB 最新 todos 為準 append），避免按「儲存」時被舊快照覆寫
      void patchTripTodos(trip.id, (fresh) => [...fresh, newTodoItem])
        .catch((e) => console.error('[TripEditor] patchTripTodos add failed', e));
      void insertTodoRow(trip.id, newTodoItem).catch((e) => console.error('[TripEditor] todos table insert failed', e));
    } else {
      console.log('[TripEditor] addTodo: 新行程尚未儲存，跳過寫入 todos 表');
    }
  };

  const removeTodo = (todoId: string) => {
    update('todos', trip.todos.filter((t) => t.id !== todoId));
    console.log(`[TripEditor] removeTodo: 刪除 todoId=${todoId}`);
    if (!isNewTrip) {
      void patchTripTodos(trip.id, (fresh) => fresh.filter((t) => t.id !== todoId))
        .catch((e) => console.error('[TripEditor] patchTripTodos remove failed', e));
      void deleteTodoRow(todoId).catch((e) => console.error('[TripEditor] todos table delete failed', e));
    } else {
      console.log('[TripEditor] removeTodo: 新行程尚未儲存，跳過刪除 todos 表');
    }
  };

  const updateFlight = (direction: 'departure' | 'return', field: string, value: string | number) => {
    setTrip((prev) => ({
      ...prev,
      flights: { ...prev.flights, [direction]: { ...prev.flights[direction], [field]: value } },
    }));
  };

  const addHotel = () => {
    const newHotel: HotelInfo = { id: crypto.randomUUID(), name: '', checkIn: '', checkOut: '', address: '', confirmationNumber: '' };
    update('hotels', [...trip.hotels, newHotel]);
  };

  const updateHotel = (id: string, field: keyof HotelInfo, value: string) => {
    update('hotels', trip.hotels.map((h) => (h.id === id ? { ...h, [field]: value } : h)));
  };

  /** PlacesAutocomplete 選址時一次寫入地址 + 座標 + placeId，確保飯店可畫在地圖上 */
  const updateHotelPlace = (id: string, place: PlaceData) => {
    setTrip((prev) => ({
      ...prev,
      hotels: prev.hotels.map((h) =>
        h.id === id
          ? { ...h, address: place.address, placeId: place.placeId, lat: place.lat, lng: place.lng }
          : h,
      ),
    }));
  };

  const addDay = () => {
    const lastYmd =
      trip.dailyItineraries.length > 0
        ? trip.dailyItineraries[trip.dailyItineraries.length - 1].date.split('T')[0]
        : trip.startDate
          ? trip.startDate.split('T')[0]
          : format(new Date(), 'yyyy-MM-dd');
    const dateStr = addCalendarDaysIso(lastYmd, 1);
    update('dailyItineraries', [...trip.dailyItineraries, { date: dateStr, activities: [] }]);
  };

  const updateDayDate = (dayIndex: number, newDate: string) => {
    const updated = [...trip.dailyItineraries];
    updated[dayIndex] = { ...updated[dayIndex], date: newDate };
    update('dailyItineraries', updated);
  };

  const addActivity = (dayIndex: number) => {
    const newActivity: ActivityCard = {
      id: crypto.randomUUID(),
      title: '',
      type: '景點',
      address: '',
      notes: '',
    };
    const updated = [...trip.dailyItineraries];
    updated[dayIndex] = { ...updated[dayIndex], activities: [...updated[dayIndex].activities, newActivity] };
    update('dailyItineraries', updated);
  };

  const updateActivity = (dayIndex: number, actId: string, field: string, value: unknown) => {
    const updated = [...trip.dailyItineraries];
    updated[dayIndex] = {
      ...updated[dayIndex],
      activities: updated[dayIndex].activities.map((a) => {
        if (a.id !== actId) return a;
        return { ...a, [field]: value };
      }),
    };
    update('dailyItineraries', updated);
  };

  const deleteActivity = (dayIndex: number, actId: string) => {
    const updated = [...trip.dailyItineraries];
    updated[dayIndex] = {
      ...updated[dayIndex],
      activities: updated[dayIndex].activities.filter((a) => a.id !== actId),
    };
    update('dailyItineraries', updated);
  };

  /**
   * Upload a blob via the backend presigned-PUT endpoint and return a
   * cache-busted public URL. Throws on any failure.
   */
  const uploadCoverBlob = async (blob: Blob, contentType: string): Promise<string> => {
    const { uploadUrl, publicUrl } = await api.createCoverPresign({
      kind: 'cover',
      contentType,
      size: blob.size,
    });
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    });
    if (!putRes.ok) throw new Error(`cover upload failed: ${putRes.status}`);
    return `${publicUrl}?t=${Date.now()}`;
  };

  /**
   * Called when the user clicks 儲存. If coverImage is still a legacy base64
   * data URL, upload it via presigned-PUT first and swap in the HTTPS URL —
   * transparent lazy migration. On any upload error, falls back to saving
   * with the original base64 so the user is never blocked.
   */
  const handleSave = async () => {
    let tripToSave = trip;

    if (trip.coverImage.startsWith('data:')) {
      try {
        const res = await fetch(trip.coverImage);
        const blob = await res.blob();
        const newUrl = await uploadCoverBlob(blob, blob.type || 'image/jpeg');
        tripToSave = { ...trip, coverImage: newUrl };
        update('coverImage', newUrl);
      } catch (err) {
        console.error('封面遷移失敗，以原始 base64 儲存', err);
        // Non-blocking: proceed with base64 rather than blocking the save
      }
    }

    onSave(tripToSave);
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverUploading(true);
    try {
      const url = await uploadCoverBlob(file, file.type || 'image/jpeg');
      update('coverImage', url);
    } catch (err) {
      console.error('封面上傳失敗，改用本機預覽', err);
      const dataUrl = await fileToDataUrl(file);
      update('coverImage', dataUrl);
    } finally {
      setCoverUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <button onClick={onCancel} className="p-2 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <h2 className="text-xl font-bold text-foreground flex-1">編輯行程</h2>
        <button
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="px-6 py-2 rounded-lg bg-action text-action-foreground font-medium hover:bg-action/90 disabled:opacity-60"
        >
          {isSaving ? '儲存中...' : '儲存'}
        </button>
      </div>

      <Tabs defaultValue="itinerary" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="itinerary">行程內容</TabsTrigger>
          <TabsTrigger value="expenses">記帳管理</TabsTrigger>
        </TabsList>

        <TabsContent value="itinerary" className="mt-6 space-y-8">
      {/* Section 1: Basic Info */}
      <div className="bg-card rounded-xl p-6 shadow-sm space-y-4">
        <h3 className="font-semibold text-foreground">基本資訊</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">行程標題</label>
            <input value={trip.title} onChange={(e) => update('title', e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-sm outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">封面圖片</label>
            <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
            <button
              onClick={() => coverInputRef.current?.click()}
              disabled={coverUploading}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed bg-background text-muted-foreground text-sm hover:border-secondary hover:text-secondary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {coverUploading ? (
                <><span className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" /> 上傳中...</>
              ) : (
                <><Upload className="h-4 w-4" /> {trip.coverImage ? '重新上傳封面' : '上傳封面圖片'}</>
              )}
            </button>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">開始日期</label>
            <input type="date" value={trip.startDate} onChange={(e) => update('startDate', e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-sm outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">結束日期</label>
            <input type="date" value={trip.endDate} onChange={(e) => update('endDate', e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-sm outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">行程分類</label>
            <select value={trip.category} onChange={(e) => update('category', e.target.value as any)} className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-sm outline-none">
              <option value="domestic">國內旅遊</option>
              <option value="international">國外旅遊</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">行程狀態</label>
            <select value={trip.status} onChange={(e) => update('status', e.target.value as any)} className="w-full px-3 py-2 rounded-lg border bg-background text-foreground text-sm outline-none">
              <option value="planning">規劃中</option>
              <option value="ongoing">進行中</option>
              <option value="completed">已完成</option>
            </select>
          </div>
        </div>
        {trip.coverImage && (
          <img src={trip.coverImage} alt="封面預覽" className="w-full max-w-md h-48 object-cover rounded-lg mt-2" />
        )}
      </div>

      {/* Section 2: Flights */}
      <div className="bg-card rounded-xl p-6 shadow-sm space-y-4">
        <h3 className="font-semibold text-foreground">航班資訊</h3>
        <div className="grid md:grid-cols-2 gap-6">
          {(['departure', 'return'] as const).map((dir) => (
            <div key={dir} className="space-y-3">
              <p className="text-sm font-medium text-secondary">{dir === 'departure' ? '去程' : '回程'}</p>
              {(['airline', 'flightNumber', 'departureAirport', 'arrivalAirport', 'departureTime', 'arrivalTime'] as const).map((field) => (
                <div key={field}>
                  <label className="block text-xs text-muted-foreground mb-1">
                    {{ airline: '航空公司', flightNumber: '航班編號', departureAirport: '出發機場', arrivalAirport: '抵達機場', departureTime: '出發時間', arrivalTime: '抵達時間' }[field]}
                  </label>
                  <input
                    value={(trip.flights[dir] as any)[field]}
                    onChange={(e) => updateFlight(dir, field, e.target.value)}
                    className="w-full px-3 py-1.5 rounded-md border bg-background text-foreground text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">托運行李 (Kg)</label>
                <input
                  type="number"
                  value={trip.flights[dir].checkedBaggage || ''}
                  onChange={(e) => updateFlight(dir, 'checkedBaggage', Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-md border bg-background text-foreground text-sm outline-none focus:ring-1 focus:ring-ring"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">隨身行李 (Kg)</label>
                <input
                  type="number"
                  value={trip.flights[dir].carryOnBaggage || ''}
                  onChange={(e) => updateFlight(dir, 'carryOnBaggage', Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-md border bg-background text-foreground text-sm outline-none focus:ring-1 focus:ring-ring"
                  placeholder="0"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Hotels */}
      <div className="bg-card rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">住宿資訊</h3>
          <button onClick={addHotel} className="flex items-center gap-1 text-sm text-action hover:text-action/80">
            <Plus className="h-4 w-4" /> 新增
          </button>
        </div>
        {trip.hotels.map((hotel) => (
          <div key={hotel.id} className="grid md:grid-cols-4 gap-3 p-3 rounded-lg bg-muted/50 relative">
            <input value={hotel.name} onChange={(e) => updateHotel(hotel.id, 'name', e.target.value)} placeholder="飯店名稱" className="px-2 py-1.5 rounded border bg-background text-foreground text-sm outline-none" />
            <input type="date" value={hotel.checkIn} onChange={(e) => updateHotel(hotel.id, 'checkIn', e.target.value)} className="px-2 py-1.5 rounded border bg-background text-foreground text-sm outline-none" />
            <input type="date" value={hotel.checkOut} onChange={(e) => updateHotel(hotel.id, 'checkOut', e.target.value)} className="px-2 py-1.5 rounded border bg-background text-foreground text-sm outline-none" />
            <div className="flex gap-2 min-w-0">
              {mapsReady ? (
                <PlacesAutocomplete
                  initialValue={hotel.address}
                  onPlaceSelect={(data) => updateHotelPlace(hotel.id, data)}
                  onBlur={(value) => updateHotel(hotel.id, 'address', value)}
                  className="flex-1 min-w-0"
                />
              ) : (
                <input
                  value={hotel.address}
                  onChange={(e) => updateHotel(hotel.id, 'address', e.target.value)}
                  placeholder="輸入地址（Maps API 未載入）"
                  className="flex-1 min-w-0 px-2 py-1.5 rounded border bg-background text-foreground text-sm outline-none overflow-hidden"
                />
              )}
              <button onClick={() => update('hotels', trip.hotels.filter((h) => h.id !== hotel.id))} className="text-destructive shrink-0">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Section 3: Daily Itineraries */}
      <div className="bg-card rounded-xl p-6 shadow-sm space-y-4">
        <h3 className="font-semibold text-foreground">每日行程</h3>

        {/* 橫向天數 Tab */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b" style={{ scrollbarWidth: 'thin' }}>
          {trip.dailyItineraries.map((day, dayIdx) => (
            <div key={dayIdx} className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => { setActiveDayIdx(dayIdx); setMapDayIdx(dayIdx); setActiveActivityId(null); setRouteSegments([]); setOriginSegment(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeDayIdx === dayIdx
                    ? 'bg-action text-action-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: getDayColor(dayIdx) }}
                />
                <span>Day {dayIdx + 1}</span>
                <input
                  type="date"
                  value={day.date}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { e.stopPropagation(); updateDayDate(dayIdx, e.target.value); }}
                  className="bg-transparent text-xs outline-none border-none cursor-pointer w-28"
                />
              </button>
              <button
                onClick={() => {
                  update('dailyItineraries', trip.dailyItineraries.filter((_, i) => i !== dayIdx));
                  const next = Math.min(activeDayIdx, trip.dailyItineraries.length - 2);
                  setActiveDayIdx(next < 0 ? 0 : next);
                  setMapDayIdx(null);
                }}
                className="w-5 h-5 rounded-full border border-muted-foreground/40 text-muted-foreground hover:bg-destructive hover:border-destructive hover:text-destructive-foreground flex items-center justify-center transition-colors"
                title="刪除此日期"
              >
                <span className="text-sm font-bold leading-none">−</span>
              </button>
            </div>
          ))}
          <button
            onClick={() => { addDay(); setActiveDayIdx(trip.dailyItineraries.length); setMapDayIdx(null); }}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-action hover:bg-muted transition-colors"
          >
            <Plus className="h-4 w-4" /> 新增日期
          </button>
        </div>

        {/* 左右分割：左 40% 卡片列表 / 右 60% Google Maps */}
        {trip.dailyItineraries.length > 0 && (() => {
          const safeIdx = Math.min(activeDayIdx, trip.dailyItineraries.length - 1);
          const activeDay = trip.dailyItineraries[safeIdx];
          // mapActivities is memoised at component level — do NOT redefine here.

          return (
            <div className="flex gap-4" style={{ minHeight: '500px' }}>
              {/* 左側：活動卡片列表 */}
              <div className="w-[40%] overflow-y-auto space-y-2 pr-1" style={{ maxHeight: '600px', scrollbarWidth: 'thin' }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); dragOverActivity.current = { dayIdx: safeIdx, actIdx: activeDay.activities.length }; }}
                onDrop={(e) => { e.stopPropagation(); handleActivityDrop(e); }}
              >
                {/* 飯店 origin → 第 1 站 的旅行資訊（有 hotel origin 時才顯示） */}
                {originSegment && originSegment.duration && (
                  <div className="flex items-center gap-2 px-2 py-0.5 select-none">
                    <div className="flex-1 border-t border-dashed border-border/60" />
                    <span
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap"
                      style={{ color: getDayColor(safeIdx) }}
                    >
                      🏨 🚗 {originSegment.duration}{originSegment.distance ? ` · ${originSegment.distance}` : ''}
                    </span>
                    <div className="flex-1 border-t border-dashed border-border/60" />
                  </div>
                )}
                {activeDay.activities.map((act, actIdx) => {
                  const isExpanded = expandedCards.has(act.id);
                  // 從此站出發到下一點（下一 activity 或 hotel destination）的旅行資訊
                  const seg = routeSegments[actIdx];
                  return (
                    <Fragment key={act.id}>
                    <div
                      ref={(el) => { cardRefs.current[act.id] = el; }}
                      className={`bg-muted/50 rounded-lg border-2 text-sm transition-all duration-200 ${
                        activeActivityId === act.id
                          ? ''
                          : 'border-transparent hover:border-secondary/20'
                      }`}
                      style={activeActivityId === act.id ? {
                        borderColor: getDayColor(safeIdx),
                        boxShadow: `0 0 0 3px ${getDayColor(safeIdx)}30, 0 4px 14px rgba(0,0,0,0.12)`,
                      } : undefined}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); handleActivityDragStart(safeIdx, actIdx); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); dragOverActivity.current = { dayIdx: safeIdx, actIdx }; }}
                      onDrop={(e) => { e.stopPropagation(); handleActivityDrop(e); }}
                    >
                      {/* 收合列（永遠顯示） */}
                      <div
                        className="flex items-center gap-2 px-2 py-2 cursor-pointer select-none"
                        onClick={() => toggleCard(act.id, safeIdx)}
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" onClick={(e) => e.stopPropagation()} />
                        {/* 數字序號，若已有 lat/lng 顯示定位圓點 */}
                        <span className={`text-xs w-5 shrink-0 text-center font-medium ${act.lat ? 'text-action' : 'text-muted-foreground'}`}>
                          {actIdx + 1}
                        </span>
                        {act.time && (
                          <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                            {act.time}
                          </span>
                        )}
                        <input
                          value={act.title}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => { e.stopPropagation(); updateActivity(safeIdx, act.id, 'title', e.target.value); }}
                          placeholder="景點名稱"
                          className="flex-1 min-w-0 text-sm bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                        />
                        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>

                      {/* 展開內容 */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border/50">
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-muted-foreground shrink-0 w-10">時間</label>
                            <input
                              type="time"
                              value={act.time ?? ''}
                              onChange={(e) => updateActivity(safeIdx, act.id, 'time', e.target.value)}
                              className="text-sm px-2 py-1 rounded border bg-background text-foreground outline-none"
                            />
                          </div>
                          <select
                            value={act.type}
                            onChange={(e) => updateActivity(safeIdx, act.id, 'type', e.target.value)}
                            className="w-full px-2 py-1 rounded border bg-background text-foreground text-sm"
                          >
                            <option>景點</option><option>美食</option><option>購物</option><option>交通</option><option>其他</option>
                          </select>

                          {/* Places Autocomplete（需 API 金鑰；無金鑰時 fallback 純文字輸入） */}
                          {mapsReady ? (
                            <PlacesAutocomplete
                              key={act.id}
                              initialValue={act.address}
                              onPlaceSelect={(place) => handlePlaceSelect(safeIdx, act.id, place)}
                              className="w-full"
                            />
                          ) : (
                            <input
                              value={act.address}
                              onChange={(e) => updateActivity(safeIdx, act.id, 'address', e.target.value)}
                              placeholder="輸入地址（Maps API 未載入）"
                              className="w-full px-2 py-1 rounded border bg-background text-foreground outline-none text-sm"
                            />
                          )}

                          <textarea
                            value={act.notes}
                            onChange={(e) => updateActivity(safeIdx, act.id, 'notes', e.target.value)}
                            placeholder="備註 (支援HTML)"
                            rows={2}
                            className="w-full px-2 py-1 rounded border bg-background text-foreground outline-none text-sm"
                          />
                          <button
                            onClick={() => deleteActivity(safeIdx, act.id)}
                            className="flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> 刪除卡片
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Travel info pill：此站 → 下一點（下一 activity 或 hotel destination） */}
                    {seg && seg.duration && (
                      <div className="flex items-center gap-2 px-2 py-0.5 select-none">
                        <div className="flex-1 border-t border-dashed border-border/60" />
                        <span
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground whitespace-nowrap"
                          style={{ color: getDayColor(safeIdx) }}
                        >
                          🚗 {seg.duration}{seg.distance ? ` · ${seg.distance}` : ''}
                        </span>
                        <div className="flex-1 border-t border-dashed border-border/60" />
                      </div>
                    )}
                    </Fragment>
                  );
                })}
                <button
                  onClick={() => addActivity(safeIdx)}
                  className="w-full py-2 rounded-lg border-2 border-dashed border-border text-muted-foreground text-sm hover:border-action hover:text-action transition-colors flex items-center justify-center gap-1"
                >
                  <Plus className="h-4 w-4" /> 新增卡片
                </button>
              </div>

              {/* 右側：Google Maps 區 */}
              <div className="flex-1 rounded-lg overflow-hidden bg-muted" style={{ height: '600px', position: 'sticky', top: '1rem' }}>
                {mapsReady ? (
                  <ItineraryMap
                    ref={mapHandleRef}
                    activities={mapActivities}
                    hotels={dayHotels}
                    dayDate={dayDate}
                    showMarkers={mapDayIdx !== null}
                    dayIndex={mapDayIdx ?? safeIdx}
                    activeActivityId={activeActivityId}
                    onMarkerClick={handleMarkerClick}
                    onRouteSegments={(segs, origin) => { setRouteSegments(segs); setOriginSegment(origin); }}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                    <svg className="h-10 w-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <p className="text-sm text-center px-4">
                      {import.meta.env.VITE_GOOGLE_MAPS_API_KEY
                        ? '地圖載入中...'
                        : '請在 .env 設定 VITE_GOOGLE_MAPS_API_KEY'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {trip.dailyItineraries.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">尚未新增日期，請點擊「新增日期」開始規劃行程。</p>
        )}
      </div>

      {/* Section 3.5: Todos */}
      <div className="bg-card rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">待辦事項</h3>
          {showTodoInput ? null : (
            <button
              type="button"
              onClick={() => {
                resetTodoForm();
                setShowTodoInput(true);
              }}
              className="flex items-center gap-1 text-sm text-action hover:text-action/80"
            >
              <Plus className="h-4 w-4" /> 新增待辦
            </button>
          )}
        </div>

        <div className="space-y-2">
          {trip.todos.length === 0 && (
            <p className="text-sm text-muted-foreground">尚未新增待辦事項</p>
          )}

          {trip.todos.map((todo) => (
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
                <div key={todo.id} className={`flex items-start gap-3 rounded-lg p-2 ${isExpired ? 'bg-muted/40' : 'bg-transparent'}`}>
              <button
                type="button"
                onClick={() => toggleTodo(todo.id)}
                className={`w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                  todo.checked ? 'bg-secondary border-secondary' : 'border-border hover:border-secondary'
                }`}
              >
                {todo.checked && <Check className="h-3 w-3 text-secondary-foreground" />}
              </button>
              <button
                type="button"
                onClick={() => toggleTodo(todo.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className={`text-sm ${todo.checked ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {todo.text}
                </div>
                {todo.dueAt && (
                  <div
                    className={`text-xs mt-1 ${todo.checked ? 'text-muted-foreground/70' : 'text-muted-foreground'} flex items-center gap-1 flex-wrap`}
                  >
                    {isSoon && <Clock className="h-3.5 w-3.5 animate-pulse text-amber-500 shrink-0" />}
                    <span>{formatDateTimeZhTw(todo.dueAt)}</span>
                  </div>
                )}
                {todo.remindTime && (
                  <div className={`text-xs mt-1 ${todo.checked ? 'text-muted-foreground/70' : 'text-muted-foreground'} flex items-center gap-1`}>
                    <span>提醒：{formatDateTimeZhTw(todo.remindTime)}</span>
                  </div>
                )}
                {todo.assignedParticipantId && (() => {
                  const p = participants.find((x) => x.id === todo.assignedParticipantId);
                  return p ? (
                    <div className={`text-xs mt-1 ${todo.checked ? 'text-muted-foreground/70' : 'text-secondary'} flex items-center gap-1`}>
                      <Users className="h-3 w-3 shrink-0" />
                      <span>{p.displayName}</span>
                    </div>
                  ) : null;
                })()}
              </button>
              <button
                type="button"
                onClick={() => removeTodo(todo.id)}
                className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors mt-0.5"
                aria-label="刪除待辦"
              >
                <Trash2 className="h-4 w-4" />
              </button>
                </div>
              );
            })()
          ))}

          {showTodoInput && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2">
              <input
                autoFocus
                value={newTodo}
                onChange={(e) => setNewTodo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTodo()}
                placeholder="輸入待辦事項..."
                className="w-full sm:flex-1 min-w-[160px] text-sm px-3 py-1.5 rounded-md border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
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
                type="button"
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
          )}
        </div>
      </div>

      {/* Section 4: Luggage, Shopping & Participants（按鈕樣式與前台 TripDetail 一致） */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
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
          onClick={() => setShoppingOpen(true)}
          className="bg-card rounded-xl p-8 shadow-sm hover:shadow-md transition-shadow flex flex-col items-center gap-3 group"
        >
          <ShoppingCart className="h-10 w-10 text-secondary group-hover:scale-110 transition-transform" />
          <span className="font-medium text-foreground">採購清單</span>
        </button>
        <button
          type="button"
          onClick={() => !isNewTrip && setParticipantsOpen(true)}
          disabled={isNewTrip}
          className="bg-card rounded-xl p-8 shadow-sm hover:shadow-md transition-shadow flex flex-col items-center gap-3 group disabled:pointer-events-none disabled:opacity-50 disabled:hover:shadow-sm"
        >
          <Users className="h-10 w-10 text-secondary group-hover:scale-110 transition-transform" />
          <span className="font-medium text-foreground">行程成員</span>
          {isNewTrip && (
            <span className="text-xs text-muted-foreground text-center -mt-1">請先儲存行程後再管理</span>
          )}
        </button>
      </div>
        </TabsContent>

        <TabsContent value="expenses" className="mt-6">
          <TripExpensesPanel tripId={trip.id} disabled={isNewTrip} />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <LuggageModal
        open={luggageOpen}
        onClose={() => setLuggageOpen(false)}
        tripId={trip.id}
        luggageList={trip.luggageList}
        onUpdate={(list) => update('luggageList', list)}
      />
      <ShoppingModal
        open={shoppingOpen}
        onClose={() => setShoppingOpen(false)}
        tripId={trip.id}
        shoppingList={trip.shoppingList}
        onUpdate={(list) => update('shoppingList', list)}
      />
      <ManageParticipants tripId={trip.id} open={participantsOpen} onOpenChange={setParticipantsOpen} />
    </div>
  );
};

export default TripEditor;
