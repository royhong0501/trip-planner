/** 選擇「不提醒」時不寫入 remindTime，也不會觸發通知 */
export const NO_REMINDER_MINUTES = -1;

export const remindOffsetOptions: Array<{ label: string; minutes: number }> = [
  { label: '不提醒', minutes: NO_REMINDER_MINUTES },
  { label: '準時', minutes: 0 },
  { label: '30 分鐘前', minutes: 30 },
  { label: '1 小時前', minutes: 60 },
  { label: '2 小時前', minutes: 120 },
  { label: '1 天前', minutes: 1440 },
  { label: '2 天前', minutes: 2880 },
];

export function datetimeLocalToISO(datetimeLocal: string): string | null {
  // `datetime-local` has no timezone info, so `new Date(value)` is interpreted as local time by browsers.
  if (!datetimeLocal) return null;
  const d = new Date(datetimeLocal);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  return d.toISOString();
}

export function computeRemindTimeISO(dueAtIso: string, remindOffsetMinutes: number): string {
  const dueMs = Date.parse(dueAtIso);
  return new Date(dueMs - remindOffsetMinutes * 60_000).toISOString();
}

/** 依 datetime-local 與提醒偏移建立欄位；無截止時間或選「不提醒」時 remindTime／remindOffset 為 null */
export function buildTodoDateTimeFields(
  dueLocal: string,
  remindOffsetMinutes: number
): { dueAt: string | null; remindTime: string | null; remindOffset: number | null } {
  const dueAtIso = datetimeLocalToISO(dueLocal);
  if (!dueAtIso) {
    return { dueAt: null, remindTime: null, remindOffset: null };
  }
  if (remindOffsetMinutes === NO_REMINDER_MINUTES) {
    return { dueAt: dueAtIso, remindTime: null, remindOffset: null };
  }
  return {
    dueAt: dueAtIso,
    remindTime: computeRemindTimeISO(dueAtIso, remindOffsetMinutes),
    remindOffset: remindOffsetMinutes,
  };
}

export function formatDateTimeZhTw(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
