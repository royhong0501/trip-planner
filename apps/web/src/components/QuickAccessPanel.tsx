import { useNavigate } from 'react-router-dom';
import { Image } from 'lucide-react';
import { Trip } from '@/types/trip';

interface Props {
  trips: Trip[];
  loading?: boolean;
}

const STATUS_META: Record<Trip['status'], { label: string; dot: string; pill: string }> = {
  planning: {
    label: '規劃中',
    dot: 'bg-sky-400',
    pill: 'bg-sky-100 text-sky-700',
  },
  ongoing: {
    label: '進行中',
    dot: 'bg-amber-400',
    pill: 'bg-amber-100 text-amber-700',
  },
  completed: {
    label: '已完成',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-100 text-emerald-700',
  },
};

const formatDateRange = (start: string, end: string): string => {
  if (!start || !end) return `${start || ''}${end ? ` ~ ${end}` : ''}`.trim();
  const [sy, sm, sd] = start.split('-');
  const [ey, em, ed] = end.split('-');
  if (sy && ey && sy === ey) {
    return `${sy}/${sm}/${sd} - ${em}/${ed}`;
  }
  return `${start} - ${end}`;
};

const QuickAccessPanel = ({ trips, loading }: Props) => {
  const navigate = useNavigate();

  const latest = [...trips]
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 3);

  return (
    <aside className="bg-card/60 rounded-2xl border border-border/60 p-4 md:p-5 shadow-sm backdrop-blur-sm">
      <h3 className="text-base font-semibold text-foreground mb-4">所有行程</h3>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-14 h-14 rounded-lg bg-muted shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="h-3.5 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : latest.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          尚無行程
        </div>
      ) : (
        <ul className="space-y-3">
          {latest.map((trip) => {
            const meta = STATUS_META[trip.status];
            return (
              <li key={trip.id}>
                <button
                  onClick={() => navigate(`/trip/${trip.id}`)}
                  className="group w-full flex items-center gap-3 p-2 -mx-2 rounded-xl hover:bg-muted/60 transition-colors text-left"
                >
                  <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-muted">
                    {trip.coverImage ? (
                      <img
                        src={trip.coverImage}
                        alt={trip.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center" aria-hidden>
                        <Image className="h-5 w-5 text-muted-foreground/50" />
                      </div>
                    )}
                    <span
                      className={`absolute top-1 right-1 w-2 h-2 rounded-full ring-2 ring-white ${meta.dot}`}
                      aria-hidden
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-bold text-sm text-foreground truncate group-hover:text-secondary transition-colors">
                        {trip.title}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {formatDateRange(trip.startDate, trip.endDate)}
                    </p>
                    <span
                      className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${meta.pill}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} aria-hidden />
                      {meta.label}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
};

export default QuickAccessPanel;
