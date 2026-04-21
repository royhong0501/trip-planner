import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Plus, Check, Trash2, Loader2 } from 'lucide-react';
import { LuggageCategory } from '@/types/trip';
import { getTripParticipants } from '@/lib/expenses';
import type { TripParticipant } from '@/types/expense';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const EMPTY_PARTICIPANTS: TripParticipant[] = [];

interface Props {
  open: boolean;
  onClose: () => void;
  tripId: string;
  luggageList: LuggageCategory[];
  onUpdate?: (list: LuggageCategory[]) => void;
}

function categoryBelongsToParticipantTab(
  categoryParticipantId: string | undefined | null,
  tabParticipantId: string,
  firstParticipantId: string | undefined,
): boolean {
  const legacy = categoryParticipantId == null || categoryParticipantId === '';
  if (legacy) return tabParticipantId === firstParticipantId;
  return categoryParticipantId === tabParticipantId;
}

const LuggageModal = ({ open, onClose, tripId, luggageList, onUpdate }: Props) => {
  const [categories, setCategories] = useState<LuggageCategory[]>(luggageList);
  const [newCategory, setNewCategory] = useState('');
  const [newItems, setNewItems] = useState<Record<string, string>>({});
  const [tab, setTab] = useState('');
  const backdropPointerDownRef = useRef(false);

  const { data: participants = EMPTY_PARTICIPANTS, isLoading } = useQuery({
    queryKey: ['trip-participants', tripId],
    queryFn: () => getTripParticipants(tripId),
    enabled: open && !!tripId,
  });

  useEffect(() => {
    setCategories(luggageList);
  }, [luggageList]);

  const firstParticipantId = participants[0]?.id;
  const resolvedTab =
    participants.length === 0
      ? ''
      : participants.some((p) => p.id === tab)
        ? tab
        : participants[0]!.id;

  if (!open) return null;

  const addCategory = () => {
    if (!newCategory.trim()) return;
    if (participants.length === 0 || !resolvedTab) return;
    const next = [
      ...categories,
      { id: crypto.randomUUID(), name: newCategory.trim(), items: [], participantId: resolvedTab },
    ];
    setCategories(next);
    onUpdate?.(next);
    setNewCategory('');
  };

  const deleteCategory = (catId: string) => {
    const next = categories.filter((c) => c.id !== catId);
    setCategories(next);
    onUpdate?.(next);
  };

  const addItem = (catId: string) => {
    const text = newItems[catId]?.trim();
    if (!text) return;
    const next = categories.map((c) =>
      c.id === catId ? { ...c, items: [...c.items, { id: crypto.randomUUID(), text, checked: false }] } : c,
    );
    setCategories(next);
    onUpdate?.(next);
    setNewItems((prev) => ({ ...prev, [catId]: '' }));
  };

  const toggleItem = (catId: string, itemId: string) => {
    const next = categories.map((c) =>
      c.id === catId ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, checked: !i.checked } : i)) } : c,
    );
    setCategories(next);
    onUpdate?.(next);
  };

  const deleteItem = (catId: string, itemId: string) => {
    const next = categories.map((c) =>
      c.id === catId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c,
    );
    setCategories(next);
    onUpdate?.(next);
  };

  const renderCategories = (visible: LuggageCategory[]) => (
    <div className="space-y-6">
      {visible.map((cat) => (
        <div key={cat.id}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-foreground">{cat.name}</p>
            <button type="button" onClick={() => deleteCategory(cat.id)} className="text-destructive hover:text-destructive/80">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-1">
            {cat.items.map((item) => (
              <div key={item.id} className="flex items-center gap-2 group">
                <button
                  type="button"
                  onClick={() => toggleItem(cat.id, item.id)}
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    item.checked ? 'bg-secondary border-secondary' : 'border-border'
                  }`}
                >
                  {item.checked && <Check className="h-3 w-3 text-secondary-foreground" />}
                </button>
                <span className={`text-sm flex-1 ${item.checked ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{item.text}</span>
                <button type="button" onClick={() => deleteItem(cat.id, item.id)} className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <div className="flex gap-2 mt-1">
              <input
                value={newItems[cat.id] || ''}
                onChange={(e) => setNewItems((p) => ({ ...p, [cat.id]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addItem(cat.id)}
                placeholder="新增項目..."
                className="flex-1 text-xs px-2 py-1 rounded border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
              <button type="button" onClick={() => addItem(cat.id)} className="text-secondary hover:text-secondary/80">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCategory()}
          placeholder="新增分類..."
          disabled={participants.length === 0 || !resolvedTab}
          className="flex-1 text-sm px-3 py-1.5 rounded-md border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
        />
        <button
          type="button"
          onClick={addCategory}
          disabled={participants.length === 0 || !resolvedTab || !newCategory.trim()}
          className="px-3 py-1.5 rounded-md bg-action text-action-foreground text-sm hover:bg-action/90 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-primary/60 backdrop-blur-sm flex items-center justify-center p-4"
      onPointerDown={(e) => { backdropPointerDownRef.current = e.target === e.currentTarget; }}
      onClick={() => {
        if (!backdropPointerDownRef.current) return;
        backdropPointerDownRef.current = false;
        onClose();
      }}>
      <div className="bg-card rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h3 className="text-lg font-bold text-foreground">行李清單</h3>
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
                尚無行程成員，請至前台「行程成員」新增成員後，即可依人員管理行李。下方仍會顯示所有既有分類與項目，避免資料遺失。
              </p>
              {renderCategories(categories)}
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
                  {renderCategories(
                    categories.filter((c) => categoryBelongsToParticipantTab(c.participantId, p.id, firstParticipantId)),
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
};

export default LuggageModal;
