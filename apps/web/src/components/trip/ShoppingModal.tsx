import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { ShoppingItem } from '@/types/trip';
import { getTripParticipants } from '@/lib/expenses';
import type { TripParticipant } from '@/types/expense';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const EMPTY_PARTICIPANTS: TripParticipant[] = [];

interface Props {
  open: boolean;
  onClose: () => void;
  tripId: string;
  shoppingList: ShoppingItem[];
  onUpdate?: (list: ShoppingItem[]) => void;
}

function belongsToParticipantTab(
  itemParticipantId: string | undefined | null,
  tabParticipantId: string,
  firstParticipantId: string | undefined,
): boolean {
  const legacy = itemParticipantId == null || itemParticipantId === '';
  if (legacy) return tabParticipantId === firstParticipantId;
  return itemParticipantId === tabParticipantId;
}

const ShoppingModal = ({ open, onClose, tripId, shoppingList, onUpdate }: Props) => {
  const [items, setItems] = useState<ShoppingItem[]>(shoppingList);
  const [tab, setTab] = useState('');
  const backdropPointerDownRef = useRef(false);

  const { data: participants = EMPTY_PARTICIPANTS, isLoading } = useQuery({
    queryKey: ['trip-participants', tripId],
    queryFn: () => getTripParticipants(tripId),
    enabled: open && !!tripId,
  });

  useEffect(() => {
    setItems(shoppingList);
  }, [shoppingList]);

  const firstParticipantId = participants[0]?.id;
  const resolvedTab =
    participants.length === 0
      ? ''
      : participants.some((p) => p.id === tab)
        ? tab
        : participants[0]!.id;

  if (!open) return null;

  const addItem = () => {
    if (participants.length === 0 || !resolvedTab) return;
    const next = [
      ...items,
      {
        id: crypto.randomUUID(),
        status: 'incomplete' as const,
        name: '',
        location: '',
        price: 0,
        participantId: resolvedTab,
      },
    ];
    setItems(next);
    onUpdate?.(next);
  };

  const updateItem = (id: string, field: keyof ShoppingItem, value: unknown) => {
    const next = items.map((i) => (i.id === id ? { ...i, [field]: value } : i));
    setItems(next);
    onUpdate?.(next);
  };

  const deleteItem = (id: string) => {
    const next = items.filter((i) => i.id !== id);
    setItems(next);
    onUpdate?.(next);
  };

  const renderTable = (visible: ShoppingItem[]) => (
    <div className="overflow-x-auto rounded-md border border-border bg-table">
      <table className="w-full text-sm text-table-foreground">
        <thead>
          <tr className="border-b border-border bg-table-header text-left">
            <th className="py-2 px-2 text-table-header-foreground font-medium w-28">狀態</th>
            <th className="py-2 px-2 text-table-header-foreground font-medium">名稱</th>
            <th className="py-2 px-2 text-table-header-foreground font-medium">購買地點</th>
            <th className="py-2 px-2 text-table-header-foreground font-medium w-24">定價</th>
            <th className="py-2 px-2 text-table-header-foreground font-medium w-12"></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item) => (
            <tr key={item.id} className="border-b border-border/60 hover:bg-muted/50">
              <td className="py-2">
                <select
                  value={item.status}
                  onChange={(e) => updateItem(item.id, 'status', e.target.value)}
                  className="text-xs px-2 py-1 rounded border bg-background text-foreground"
                >
                  <option value="incomplete">未完成</option>
                  <option value="complete">已完成</option>
                </select>
              </td>
              <td className="py-2">
                <input
                  value={item.name}
                  onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                  className="w-full text-sm px-2 py-1 rounded border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
                  placeholder="品名"
                />
              </td>
              <td className="py-2">
                <input
                  value={item.location}
                  onChange={(e) => updateItem(item.id, 'location', e.target.value)}
                  className="w-full text-sm px-2 py-1 rounded border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
                  placeholder="地點"
                />
              </td>
              <td className="py-2">
                <input
                  type="number"
                  value={item.price || ''}
                  onChange={(e) => updateItem(item.id, 'price', Number(e.target.value))}
                  className="w-full text-sm px-2 py-1 rounded border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
                  placeholder="0"
                />
              </td>
              <td className="py-2 text-center">
                <button onClick={() => deleteItem(item.id)} className="text-destructive hover:text-destructive/80">
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const addButton = (
    <button
      type="button"
      onClick={addItem}
      disabled={participants.length === 0 || !resolvedTab}
      className="mt-4 flex items-center gap-1 text-sm px-3 py-1.5 rounded-md bg-action text-action-foreground hover:bg-action/90 transition-colors disabled:pointer-events-none disabled:opacity-40"
    >
      <Plus className="h-4 w-4" /> 新增項目
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-primary/60 backdrop-blur-sm flex items-center justify-center p-4"
      onPointerDown={(e) => { backdropPointerDownRef.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (!backdropPointerDownRef.current) return; backdropPointerDownRef.current = false; onClose(); }}>
      <div className="bg-card rounded-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto shadow-2xl animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h3 className="text-lg font-bold text-foreground">採購清單</h3>
          <button type="button" onClick={onClose}>
            <X className="h-5 w-5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
        <div className="p-6">
          {isLoading ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" aria-label="載入中" />
            </div>
          ) : participants.length === 0 ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                尚無行程成員，請至前台「行程成員」新增成員後，即可依人員管理採購項目。下方仍會顯示所有既有項目，避免資料遺失。
              </p>
              {renderTable(items)}
              {addButton}
            </>
          ) : (
            <Tabs value={resolvedTab} onValueChange={setTab}>
              <div className="mb-4 w-full min-w-0 overflow-x-auto overflow-y-hidden rounded-md [-webkit-overflow-scrolling:touch] [scrollbar-gutter:stable]">
                <TabsList className="inline-flex h-auto min-h-10 w-max max-w-none flex-nowrap justify-start gap-1 bg-muted p-1">
                  {participants.map((p) => (
                    <TabsTrigger key={p.id} value={p.id} className="shrink-0">
                      {p.displayName}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              {participants.map((p) => (
                <TabsContent key={p.id} value={p.id} className="mt-0 ring-offset-0 focus-visible:ring-0">
                  {renderTable(
                    items.filter((item) =>
                      belongsToParticipantTab(item.participantId, p.id, firstParticipantId),
                    ),
                  )}
                  {addButton}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShoppingModal;
