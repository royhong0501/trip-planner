import { useState, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createExpense, getTripParticipants } from '@/lib/expenses';
import type { CreateExpenseSplitPayload } from '@/types/expense';

interface Props {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function todayISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 將總額（元）均分為 n 份，以「分」為整數單位避免浮點誤差 */
function equalSplitCents(total: number, participantIds: string[]): CreateExpenseSplitPayload[] {
  const n = participantIds.length;
  if (n === 0) return [];
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return participantIds.map((participantId, i) => ({
    participantId,
    owedAmount: (base + (i < remainder ? 1 : 0)) / 100,
  }));
}

function parseAmount(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function areSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

const EMPTY_PARTICIPANTS: Awaited<ReturnType<typeof getTripParticipants>> = [];

/** 由外幣切到 TWD 以外時，若匯率仍為 1 則帶入粗略預設（可再自行修改） */
const DEFAULT_EXCHANGE_RATE_BY_CURRENCY: Record<string, string> = {
  USD: '31.5',
  JPY: '0.21',
  KRW: '0.023',
  EUR: '34',
};

const AddExpenseModal = ({ tripId, open, onOpenChange }: Props) => {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [currency, setCurrency] = useState('TWD');
  const [exchangeRateStr, setExchangeRateStr] = useState('1');
  const [payerId, setPayerId] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayISODate);
  /** 參與分攤的成員 id */
  const [includedIds, setIncludedIds] = useState<Set<string>>(() => new Set());
  /** 每人分攤金額字串 */
  const [owedStrByParticipant, setOwedStrByParticipant] = useState<Record<string, string>>({});

  const { data: participants = EMPTY_PARTICIPANTS, isLoading } = useQuery({
    queryKey: ['trip-participants', tripId],
    queryFn: () => getTripParticipants(tripId),
    enabled: open && !!tripId,
  });

  const wasOpenRef = useRef(false);

  const participantIds = useMemo(() => participants.map((p) => p.id), [participants]);
  const participantIdsKey = useMemo(() => participantIds.join(','), [participantIds]);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setAmountStr('');
      setCurrency('TWD');
      setExchangeRateStr('1');
      setPayerId('');
      setExpenseDate(todayISODate());
      setIncludedIds((prev) => (prev.size === 0 ? prev : new Set()));
      setOwedStrByParticipant((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      wasOpenRef.current = false;
      return;
    }

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      if (participantIds.length > 0) {
        const allIncluded = new Set(participantIds);
        setIncludedIds((prev) => (areSetsEqual(prev, allIncluded) ? prev : allIncluded));
        setPayerId((prev) => (prev || participantIds[0]));
      }
      return;
    }

    if (participantIds.length > 0) {
      const ids = new Set(participantIds);
      setPayerId((prev) => (prev && ids.has(prev) ? prev : participantIds[0]));
      setIncludedIds((prev) => {
        const next = new Set<string>();
        prev.forEach((id) => {
          if (ids.has(id)) next.add(id);
        });
        if (next.size === 0) participantIds.forEach((id) => next.add(id));
        return areSetsEqual(prev, next) ? prev : next;
      });
    }
  }, [open, participantIdsKey]);

  const includedList = useMemo(() => participants.filter((p) => includedIds.has(p.id)), [participants, includedIds]);

  const includedParticipantIds = useMemo(() => includedList.map((p) => p.id), [includedList]);
  const includedIdsKey = useMemo(() => includedParticipantIds.join(','), [includedParticipantIds]);

  /** 主檔幣別金額（原幣） */
  const amountTotalParsed = useMemo(() => parseAmount(amountStr), [amountStr]);

  const effectiveExchangeRate = useMemo(() => {
    if (currency === 'TWD') return 1;
    const ex = parseAmount(exchangeRateStr);
    return ex != null && ex > 0 ? ex : null;
  }, [currency, exchangeRateStr]);

  /** 分攤用：原幣 × 匯率 = 新台幣等值 */
  const baseAmount = useMemo(() => {
    if (amountTotalParsed == null || amountTotalParsed < 0) return null;
    if (effectiveExchangeRate == null) return null;
    return amountTotalParsed * effectiveExchangeRate;
  }, [amountTotalParsed, effectiveExchangeRate]);

  /** 總金額、匯率、勾選成員變動時，分攤列即時以 TWD 均分 */
  useEffect(() => {
    if (includedParticipantIds.length === 0) return;
    if (baseAmount == null) {
      setOwedStrByParticipant({});
      return;
    }
    const splits = equalSplitCents(baseAmount, includedParticipantIds);
    const next: Record<string, string> = {};
    splits.forEach((s) => {
      next[s.participantId] = String(s.owedAmount);
    });
    setOwedStrByParticipant(next);
  }, [baseAmount, includedIdsKey]);

  const toggleIncluded = (id: string, checked: boolean) => {
    setIncludedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const total = parseAmount(amountStr);
      if (total == null || total < 0) throw new Error('請輸入有效的總金額');
      const ex = currency === 'TWD' ? 1 : parseAmount(exchangeRateStr);
      if (ex == null || ex <= 0) throw new Error('匯率必須大於 0');
      if (baseAmount == null) throw new Error('無法計算新台幣等值，請檢查金額與匯率');
      if (!payerId) throw new Error('請選擇付款人');
      const ids = includedParticipantIds;
      if (ids.length === 0) throw new Error('請至少勾選一位參與分攤的成員');

      const splits: CreateExpenseSplitPayload[] = [];
      let sum = 0;
      for (const pid of ids) {
        const raw = owedStrByParticipant[pid] ?? '0';
        const owed = parseAmount(raw);
        if (owed == null || owed < 0) throw new Error(`成員分攤金額無效`);
        splits.push({ participantId: pid, owedAmount: owed });
        sum += owed;
      }
      if (Math.abs(sum - baseAmount) > 0.01) {
        throw new Error(
          `分攤加總 (${sum.toFixed(2)} TWD) 需與新台幣等值 (${baseAmount.toFixed(2)} TWD) 一致（允許 0.01 誤差）`,
        );
      }

      return createExpense(
        {
          tripId,
          title: title.trim(),
          amountTotal: total,
          currency: currency.trim() || 'TWD',
          exchangeRate: ex,
          payerId,
          expenseDate,
        },
        splits,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip-expenses', tripId] });
      queryClient.invalidateQueries({ queryKey: ['trip-participants', tripId] });
      toast.success('已新增花費');
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(e.message || '新增失敗，請確認已登入後台帳號');
    },
  });

  const inputClass =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>記帳器 · 新增花費</DialogTitle>
          <DialogDescription>建立一筆花費並設定分攤明細。新增需具備已登入權限。</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : participants.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">請先在「行程成員」新增至少一位成員，才能記帳。</p>
        ) : (
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="exp-title">標題</Label>
              <Input
                id="exp-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：晚餐、車資"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="exp-amount">總金額（原幣）</Label>
                <Input
                  id="exp-amount"
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0"
                />
                {baseAmount != null && (
                  <p className="text-xs text-muted-foreground">
                    等值約{' '}
                    <span className="font-medium text-foreground tabular-nums">
                      {baseAmount.toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}{' '}
                      TWD
                    </span>
                  </p>
                )}
                {amountTotalParsed != null &&
                  amountTotalParsed >= 0 &&
                  currency !== 'TWD' &&
                  effectiveExchangeRate == null && (
                    <p className="text-xs text-destructive">請輸入有效匯率以計算新台幣等值</p>
                  )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp-currency">幣別</Label>
                <Select
                  value={currency}
                  onValueChange={(next) => {
                    if (next === 'TWD') {
                      setCurrency('TWD');
                      setExchangeRateStr('1');
                    } else {
                      setCurrency(next);
                      setExchangeRateStr((prev) => {
                        if (currency === 'TWD' && prev === '1') {
                          return DEFAULT_EXCHANGE_RATE_BY_CURRENCY[next] ?? '0.2';
                        }
                        return prev;
                      });
                    }
                  }}
                >
                  <SelectTrigger id="exp-currency" className="w-full">
                    <SelectValue placeholder="選擇幣別" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TWD">TWD（新台幣）</SelectItem>
                    <SelectItem value="USD">USD（美元）</SelectItem>
                    <SelectItem value="JPY">JPY（日圓）</SelectItem>
                    <SelectItem value="KRW">KRW（韓元）</SelectItem>
                    <SelectItem value="EUR">EUR（歐元）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {currency !== 'TWD' && (
              <div className="space-y-2">
                <Label htmlFor="exp-rate">匯率（1 {currency} 兌多少 TWD）</Label>
                <Input
                  id="exp-rate"
                  inputMode="decimal"
                  value={exchangeRateStr}
                  onChange={(e) => setExchangeRateStr(e.target.value)}
                  placeholder={DEFAULT_EXCHANGE_RATE_BY_CURRENCY[currency] ?? '0.2'}
                />
                <p className="text-xs text-muted-foreground">分攤金額一律以新台幣（TWD）計算並儲存。</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="exp-date">日期</Label>
                <Input
                  id="exp-date"
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exp-payer">付款人</Label>
                <select
                  id="exp-payer"
                  value={payerId}
                  onChange={(e) => setPayerId(e.target.value)}
                  className={inputClass}
                >
                  {participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <div>
                <Label className="text-foreground">分攤成員與金額</Label>
                <p className="text-xs text-muted-foreground mt-0.5">單位：TWD（新台幣）</p>
              </div>
              <ul className="space-y-2">
                {participants.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                    <div className="flex items-center gap-2 min-w-[140px]">
                      <Checkbox
                        id={`inc-${p.id}`}
                        checked={includedIds.has(p.id)}
                        onCheckedChange={(c) => toggleIncluded(p.id, c === true)}
                      />
                      <label htmlFor={`inc-${p.id}`} className="text-sm cursor-pointer truncate">
                        {p.displayName}
                      </label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="max-w-[120px]"
                        inputMode="decimal"
                        disabled={!includedIds.has(p.id)}
                        value={owedStrByParticipant[p.id] ?? ''}
                        onChange={(e) =>
                          setOwedStrByParticipant((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        placeholder="0"
                      />
                      <span className="text-xs text-muted-foreground w-8 shrink-0">TWD</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={createMutation.isPending || participants.length === 0 || !title.trim()}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                儲存中…
              </>
            ) : (
              '儲存花費'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddExpenseModal;
