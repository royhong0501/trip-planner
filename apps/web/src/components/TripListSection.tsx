import { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, MapPin, Loader2 } from 'lucide-react';

import TripCard from './TripCard';
import QuickAccessPanel from './QuickAccessPanel';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Trip } from '@/types/trip';

type Category = 'domestic-planning' | 'domestic-ongoing' | 'domestic-completed' | 'international-planning' | 'international-ongoing' | 'international-completed';

interface CategoryGroup {
  label: string;
  items: { key: Category; label: string; category: 'domestic' | 'international'; status: 'planning' | 'ongoing' | 'completed' }[];
}

const categoryGroups: CategoryGroup[] = [
  {
    label: '國內旅遊',
    items: [
      { key: 'domestic-planning', label: '規劃中', category: 'domestic', status: 'planning' },
      { key: 'domestic-ongoing', label: '進行中', category: 'domestic', status: 'ongoing' },
      { key: 'domestic-completed', label: '已完成', category: 'domestic', status: 'completed' },
    ],
  },
  {
    label: '國外旅遊',
    items: [
      { key: 'international-planning', label: '規劃中', category: 'international', status: 'planning' },
      { key: 'international-ongoing', label: '進行中', category: 'international', status: 'ongoing' },
      { key: 'international-completed', label: '已完成', category: 'international', status: 'completed' },
    ],
  },
];

interface Props {
  trips: Trip[];
  loading?: boolean;
}

const TripListSection = ({ trips, loading }: Props) => {
  const [activeCategory, setActiveCategory] = useState<Category>('domestic-planning');
  const scrollRef = useRef<HTMLDivElement>(null);

  const allItems = categoryGroups.flatMap((g) => g.items);
  const cat = allItems.find((c) => c.key === activeCategory)!;
  const filtered = trips.filter((t) => t.category === cat.category && t.status === cat.status);

  const scroll = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 260, behavior: 'smooth' });
  };

  return (
    <section className="pt-10 md:pt-14 pb-12 md:pb-16">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-8">
          {/* Main: 75% width — category menu + trip cards */}
          <div className="lg:col-span-3 min-w-0">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
                <MapPin className="h-5 w-5 text-foreground" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-foreground">行程列表</h2>
            </div>
            <div className="flex flex-col md:flex-row gap-8">
              {/* Left: Nested Categories */}
              <div className="md:w-56 shrink-0 space-y-1">
            {categoryGroups.map((group) => {
              const isGroupActive = group.items.some((i) => i.key === activeCategory);
              return (
                <Collapsible key={group.label} defaultOpen={isGroupActive}>
                  <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm font-semibold text-foreground bg-muted hover:bg-muted/80 transition-colors">
                    {group.label}
                    <ChevronDown className="h-4 w-4 transition-transform duration-200 [&[data-state=open]]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-3 mt-1 space-y-1 border-l-2 border-border pl-3">
                      {group.items.map((item) => (
                        <button
                          key={item.key}
                          onClick={() => setActiveCategory(item.key)}
                          className={`w-full px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                            activeCategory === item.key
                              ? 'bg-secondary text-secondary-foreground font-medium'
                              : 'text-muted-foreground hover:bg-muted/60'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>

          {/* Right: Trip cards carousel */}
          <div className="flex-1 min-w-0">
            <div key={activeCategory} className="animate-fade-in">
              {loading ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground">
                  此分類尚無行程
                </div>
              ) : (
                <div className="relative">
                  <div ref={scrollRef} className="flex gap-4 overflow-x-auto scrollbar-hide pb-4">
                    {filtered.map((trip) => (
                      <TripCard key={trip.id} trip={trip} />
                    ))}
                  </div>
                  {filtered.length > 4 && (
                    <>
                      <button onClick={() => scroll(-1)} className="absolute -left-4 top-1/3 w-8 h-8 rounded-full bg-card shadow-md flex items-center justify-center hover:bg-muted transition-colors">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button onClick={() => scroll(1)} className="absolute -right-4 top-1/3 w-8 h-8 rounded-full bg-card shadow-md flex items-center justify-center hover:bg-muted transition-colors">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              )}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar: 25% — Quick Access (stacks below main on mobile) */}
          <aside className="lg:col-span-1">
            <QuickAccessPanel trips={trips} loading={loading} />
          </aside>
        </div>
      </div>
    </section>
  );
};

export default TripListSection;
