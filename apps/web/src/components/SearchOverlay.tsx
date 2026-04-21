import { useState } from 'react';
import { Image, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Trip } from '@/types/trip';

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  trips?: Trip[];
}

const SearchOverlay = ({ open, onClose, trips = [] }: SearchOverlayProps) => {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  if (!open) return null;

  const results = query.trim()
    ? trips.filter(
        (t) =>
          t.title.includes(query) ||
          t.dailyItineraries.some((d) =>
            d.activities.some((a) => a.title.includes(query) || a.notes.includes(query))
          )
      )
    : [];

  return (
    <div className="fixed inset-0 z-40 bg-primary/80 backdrop-blur-sm flex items-start justify-center pt-24 px-4">
      <div className="w-full max-w-2xl animate-slide-up">
        <div className="flex items-center gap-3 bg-card rounded-xl p-4 shadow-2xl">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋行程標題、內容關鍵字..."
            className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
          />
          <button onClick={onClose}>
            <X className="h-5 w-5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
        {results.length > 0 && (
          <div className="mt-3 bg-card rounded-xl shadow-2xl p-2 max-h-96 overflow-y-auto">
            {results.map((trip) => (
              <button
                key={trip.id}
                onClick={() => { navigate(`/trip/${trip.id}`); onClose(); }}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
              >
                {trip.coverImage ? (
                  <img src={trip.coverImage} alt={trip.title} className="w-16 h-12 rounded-md object-cover" />
                ) : (
                  <div
                    className="w-16 h-12 rounded-md bg-muted shrink-0 flex items-center justify-center"
                    aria-hidden
                  >
                    <Image className="h-5 w-5 text-muted-foreground/50" />
                  </div>
                )}
                <div>
                  <p className="font-medium text-foreground">{trip.title}</p>
                  <p className="text-sm text-muted-foreground">{trip.startDate} ~ {trip.endDate}</p>
                </div>
              </button>
            ))}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className="mt-3 bg-card rounded-xl shadow-2xl p-6 text-center text-muted-foreground">
            找不到相關結果
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchOverlay;
