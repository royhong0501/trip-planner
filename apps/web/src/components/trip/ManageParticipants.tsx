import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Trash2, UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  addTripParticipant,
  deleteTripParticipant,
  getTripParticipants,
  isTripParticipantInvolvedInLedger,
} from '@/lib/expenses';

const PARTICIPANT_DELETE_BLOCKED_MESSAGE =
  '無法刪除！此成員已參與歷史記帳。請先至記帳總覽中，將他從相關的花費項目中移除後，才能刪除此成員。';

function isParticipantDeleteBlockedError(err: unknown): boolean {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    code === '23503' ||
    /23503|foreign key|violates foreign key|still referenced|RESTRICT/i.test(`${msg} ${code}`)
  );
}

interface Props {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ManageParticipants = ({ tripId, open, onOpenChange }: Props) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [blockDeleteOpen, setBlockDeleteOpen] = useState(false);

  const { data: participants = [], isLoading, isError, error } = useQuery({
    queryKey: ['trip-participants', tripId],
    queryFn: () => getTripParticipants(tripId),
    enabled: open && !!tripId,
  });

  const addMutation = useMutation({
    mutationFn: ({ displayName, email }: { displayName: string; email: string }) =>
      addTripParticipant(tripId, displayName, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip-participants', tripId] });
      setName('');
      setEmail('');
      toast.success('已新增行程成員');
    },
    onError: (e: Error) => {
      toast.error(e.message || '新增失敗，請確認已登入後台帳號');
    },
  });

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    addMutation.mutate({ displayName: trimmed, email: email.trim() });
  };

  const handleDeleteClick = async (participantId: string) => {
    setDeleteBusyId(participantId);
    try {
      const involved = await isTripParticipantInvolvedInLedger(tripId, participantId);
      if (involved) {
        setBlockDeleteOpen(true);
        return;
      }
      await deleteTripParticipant(participantId);
      queryClient.invalidateQueries({ queryKey: ['trip-participants', tripId] });
      toast.success('已移除成員');
    } catch (err) {
      if (isParticipantDeleteBlockedError(err)) {
        setBlockDeleteOpen(true);
        return;
      }
      const msg = err instanceof Error ? err.message : '刪除失敗';
      toast.error(msg);
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>行程成員</DialogTitle>
            <DialogDescription>
              成員將用於分攤記帳的付款人與分攤對象。新增成員需具備已登入權限。已參與記帳的成員無法直接刪除。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="輸入成員名稱"
                  disabled={addMutation.isPending}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
                  className="flex-1"
                />
                <Button
                  type="button"
                  onClick={handleAdd}
                  disabled={addMutation.isPending || !name.trim()}
                  className="shrink-0"
                >
                  {addMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      新增
                    </>
                  )}
                </Button>
              </div>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email（選填，供提醒通知用）"
                disabled={addMutation.isPending}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
              />
            </div>

            <div className="rounded-md border border-border bg-muted/30">
              {isLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  載入中…
                </div>
              ) : isError ? (
                <p className="p-4 text-sm text-destructive">
                  {(error as Error)?.message ?? '無法載入成員列表'}
                </p>
              ) : participants.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">尚無成員，請新增第一位成員。</p>
              ) : (
                <ScrollArea className="h-[min(240px,40vh)] pr-3">
                  <ul className="p-2 space-y-1">
                    {participants.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm text-foreground bg-background/80 border border-border/60"
                      >
                        <div className="truncate min-w-0">
                          <span>{p.displayName}</span>
                          {p.email && (
                            <span className="block text-xs text-muted-foreground truncate">{p.email}</span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          aria-label={`刪除成員 ${p.displayName}`}
                          disabled={addMutation.isPending || deleteBusyId !== null}
                          onClick={() => handleDeleteClick(p.id)}
                        >
                          {deleteBusyId === p.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={blockDeleteOpen} onOpenChange={setBlockDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>無法刪除</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground/90 whitespace-pre-line">
              {PARTICIPANT_DELETE_BLOCKED_MESSAGE}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>我知道了</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ManageParticipants;
