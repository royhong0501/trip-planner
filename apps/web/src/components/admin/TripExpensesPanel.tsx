import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { deleteExpense, getExpensesByTripId, getTripParticipants } from '@/lib/expenses';
import AddExpenseModal from '@/components/trip/AddExpenseModal';
import { ExpenseSplitsDetail } from '@/components/trip/ExpenseSplitsDetail';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  /** 新增行程尚未首次儲存時為 true，此時無法關聯資料庫花費 */
  disabled?: boolean;
}

const TripExpensesPanel = ({ tripId, disabled = false }: Props) => {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const { data: expenses = [], isLoading, isError, error } = useQuery({
    queryKey: ['trip-expenses', tripId],
    queryFn: () => getExpensesByTripId(tripId),
    enabled: !disabled && !!tripId,
  });

  const { data: participants = [] } = useQuery({
    queryKey: ['trip-participants', tripId],
    queryFn: () => getTripParticipants(tripId),
    enabled: !disabled && !!tripId,
  });

  const nameByParticipantId = useMemo(
    () => Object.fromEntries(participants.map((p) => [p.id, p.displayName])),
    [participants],
  );

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  if (disabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">記帳管理</CardTitle>
          <CardDescription>
            請先點擊右上角「儲存」建立行程後，即可在此管理花費與分攤。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">記帳管理</CardTitle>
            <CardDescription>檢視與維護此行程的所有花費（與前台記帳器共用資料）。</CardDescription>
          </div>
          <Button type="button" onClick={() => setAddOpen(true)} className="shrink-0 w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            新增花費
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
              <Loader2 className="h-5 w-5 animate-spin" />
              載入花費列表…
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive py-6 text-center">
              {(error as Error)?.message ?? '無法載入花費'}
            </p>
          ) : expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
              尚無花費紀錄，點「新增花費」開始記帳。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">日期</TableHead>
                  <TableHead>項目名稱</TableHead>
                  <TableHead className="w-[100px]">付款人</TableHead>
                  <TableHead className="text-right w-[120px]">總金額</TableHead>
                  <TableHead className="w-[72px]">幣別</TableHead>
                  <TableHead className="w-[56px] text-right pr-2">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button')) return;
                        toggleExpanded(row.id);
                      }}
                    >
                      <TableCell className="text-muted-foreground whitespace-nowrap align-middle">
                        {row.expenseDate}
                      </TableCell>
                      <TableCell className="font-medium text-foreground align-middle">
                        <div className="flex items-center gap-2 min-w-0">
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                              expandedIds.has(row.id) && 'rotate-180',
                            )}
                            aria-hidden
                          />
                          <span className="truncate">{row.title}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground align-middle">{row.payer.displayName}</TableCell>
                      <TableCell className="text-right tabular-nums align-middle">
                        {row.amountTotal.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-muted-foreground align-middle">{row.currency}</TableCell>
                      <TableCell className="text-right align-middle">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          aria-label="刪除此筆花費"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteId(row.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedIds.has(row.id) && (
                      <TableRow className="hover:bg-transparent border-b">
                        <TableCell colSpan={6} className="bg-muted/25 py-4 align-top">
                          <p className="text-xs font-medium text-muted-foreground mb-2">分攤明細</p>
                          <div className="max-w-md">
                            <ExpenseSplitsDetail
                              splits={row.splits}
                              nameByParticipantId={nameByParticipantId}
                              expenseCurrency={row.currency}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddExpenseModal tripId={tripId} open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除此筆花費？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作無法復原，分攤明細也會一併刪除。
            </AlertDialogDescription>
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

export default TripExpensesPanel;
