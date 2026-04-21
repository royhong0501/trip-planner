import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, Receipt, ChevronDown, ArrowRight, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { deleteExpense, getExpensesByTripId, getTripParticipants } from '@/lib/expenses';
import { calculateSettlements, type SettlementTransaction } from '@/lib/settlement';
import AddExpenseModal from '@/components/trip/AddExpenseModal';
import { ExpenseSplitsDetail } from '@/components/trip/ExpenseSplitsDetail';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ExpenseLedgerModal = ({ tripId, open, onOpenChange }: Props) => {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [settlementResults, setSettlementResults] = useState<SettlementTransaction[] | null>(null);

  useEffect(() => {
    if (!open) {
      setAddOpen(false);
      setDeleteId(null);
      setExpandedIds(new Set());
      setSettlementResults(null);
    }
  }, [open]);

  const { data: expenses = [], isLoading, isError, error } = useQuery({
    queryKey: ['trip-expenses', tripId],
    queryFn: () => getExpensesByTripId(tripId),
    enabled: open && !!tripId,
  });

  const { data: participants = [] } = useQuery({
    queryKey: ['trip-participants', tripId],
    queryFn: () => getTripParticipants(tripId),
    enabled: open && !!tripId,
  });

  const nameByParticipantId = useMemo(
    () => Object.fromEntries(participants.map((p) => [p.id, p.displayName])),
    [participants],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteExpense(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip-expenses', tripId] });
      toast.success('已刪除花費');
      setDeleteId(null);
    },
    onError: (e: Error) => {
      toast.error(e.message || '刪除失敗');
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[min(90vh,640px)] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-border">
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-secondary shrink-0" />
              記帳總覽
            </DialogTitle>
            <DialogDescription>此行程的所有花費紀錄；與後台記帳管理資料相同。</DialogDescription>
          </DialogHeader>

          <div className="px-6 py-3 shrink-0 grid grid-cols-2 gap-2">
            <Button type="button" className="w-full gap-2" size="lg" onClick={() => setAddOpen(true)}>
              <Plus className="h-5 w-5 shrink-0" />
              新增花費
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full gap-2 border-2 border-secondary-foreground/15 shadow-sm"
              size="lg"
              disabled={isLoading || isError}
              onClick={() => {
                setSettlementResults(calculateSettlements(participants, expenses));
              }}
            >
              <Scale className="h-5 w-5 shrink-0" />
              結算
            </Button>
          </div>

          <div className="flex-1 min-h-0 px-6 pb-2">
            {settlementResults !== null ? (
              <div className="flex flex-col min-h-0 h-[min(340px,45vh)]">
                <div className="shrink-0 mb-3">
                  <h3 className="text-sm font-semibold text-foreground">結算結果</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">以下為債務簡化後的轉帳建議（金額單位：TWD）</p>
                </div>
                <ScrollArea className="flex-1 min-h-0 pr-3">
                  <div className="space-y-3 pb-4">
                    {settlementResults.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border bg-muted/20 py-10 px-4 text-center">
                        <p className="text-sm font-medium text-foreground">目前帳目已結清，無人欠款！</p>
                        <p className="text-xs text-muted-foreground mt-1">所有人淨餘額皆為零，無需轉帳。</p>
                      </div>
                    ) : (
                      settlementResults.map((t, idx) => (
                        <Card key={`${t.debtorId}-${t.creditorId}-${idx}`} className="overflow-hidden">
                          <CardContent className="p-4">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
                              <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                                <span className="font-medium text-foreground truncate">{t.debtorName}</span>
                                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                <span className="tabular-nums font-semibold text-foreground shrink-0">
                                  {t.amount.toLocaleString(undefined, {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  <span className="text-xs font-medium text-muted-foreground">TWD</span>
                                </span>
                                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                <span className="font-medium text-foreground truncate">{t.creditorName}</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </ScrollArea>
                <div className="shrink-0 pt-3 border-t border-border mt-auto">
                  <Button type="button" variant="outline" className="w-full" onClick={() => setSettlementResults(null)}>
                    返回明細
                  </Button>
                </div>
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 animate-spin" />
                載入中…
              </div>
            ) : isError ? (
              <p className="text-sm text-destructive py-8 text-center">
                {(error as Error)?.message ?? '無法載入記帳資料'}
              </p>
            ) : expenses.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 py-12 px-4 text-center">
                <Receipt className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">目前沒有記帳紀錄</p>
                <p className="text-xs text-muted-foreground mt-1">點上方「新增花費」開始記帳</p>
                <Button type="button" className="mt-4 gap-1.5" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" />
                  新增花費
                </Button>
              </div>
            ) : (
              <ScrollArea className="h-[min(340px,45vh)] pr-3">
                <ul className="space-y-2 pb-4">
                  {expenses.map((row) => (
                    <li key={row.id} className="rounded-lg border border-border bg-card overflow-hidden">
                      <Collapsible
                        open={expandedIds.has(row.id)}
                        onOpenChange={(next) => {
                          setExpandedIds((prev) => {
                            const n = new Set(prev);
                            if (next) n.add(row.id);
                            else n.delete(row.id);
                            return n;
                          });
                        }}
                      >
                        <div className="flex items-stretch gap-1">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex flex-1 min-w-0 items-start gap-2 text-left px-3 py-3 text-sm rounded-none hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                            >
                              <ChevronDown
                                className={cn(
                                  'h-4 w-4 shrink-0 mt-0.5 text-muted-foreground transition-transform duration-200',
                                  expandedIds.has(row.id) && 'rotate-180',
                                )}
                                aria-hidden
                              />
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="font-medium text-foreground truncate">{row.title}</span>
                                  <span className="shrink-0 tabular-nums font-medium text-foreground">
                                    {row.amountTotal.toLocaleString(undefined, {
                                      minimumFractionDigits: 0,
                                      maximumFractionDigits: 2,
                                    })}{' '}
                                    <span className="text-muted-foreground font-normal text-xs">{row.currency}</span>
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                  <span>{row.expenseDate}</span>
                                  <span>付款人：{row.payer.displayName}</span>
                                </div>
                              </div>
                            </button>
                          </CollapsibleTrigger>
                          <div className="flex items-center pr-1 shrink-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                              aria-label="刪除此筆花費"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteId(row.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                          <div className="border-t border-border bg-muted/25 px-3 py-3 pl-10">
                            <p className="text-xs font-medium text-muted-foreground mb-2">分攤明細</p>
                            <ExpenseSplitsDetail
                              splits={row.splits}
                              nameByParticipantId={nameByParticipantId}
                              expenseCurrency={row.currency}
                            />
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>

          <div className="px-6 py-4 border-t border-border shrink-0">
            <Button type="button" variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
              關閉
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AddExpenseModal tripId={tripId} open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除此筆花費？</AlertDialogTitle>
            <AlertDialogDescription>此操作無法復原，分攤明細也會一併刪除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteId) deleteMutation.mutate(deleteId);
              }}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  刪除中…
                </>
              ) : (
                '確認刪除'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ExpenseLedgerModal;
