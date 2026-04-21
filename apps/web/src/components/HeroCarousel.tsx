import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { mockCarouselSlides } from '@/data/mockData';
import { api } from '@/lib/apiClient';

type Slide = { id: string; imageUrl: string; title?: string };

const CAROUSEL_FALLBACK_IMAGE = mockCarouselSlides[0].imageUrl;
const CACHE_KEY = 'rq:carousel-slides';
const CACHE_TS_KEY = 'rq:carousel-slides:ts';

function isValidImageUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (u.startsWith('/')) return true;
  if (u.startsWith('data:image/')) return true;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeCarouselSlides(raw: unknown): Slide[] {
  if (!Array.isArray(raw)) return [];
  const out: Slide[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const imageUrl = typeof row.imageUrl === 'string' ? row.imageUrl : '';
    if (!isValidImageUrl(imageUrl)) continue;
    const id =
      typeof row.id === 'string' && row.id.trim()
        ? row.id
        : `slide-${i}-${imageUrl.slice(0, 32)}`;
    const slide: Slide = { id, imageUrl: imageUrl.trim() };
    if (typeof row.title === 'string' && row.title.trim()) slide.title = row.title.trim();
    out.push(slide);
  }
  return out;
}

async function fetchCarouselSlides(): Promise<Slide[]> {
  try {
    const entry = await api.getHomepageSetting<Slide[] | string>('carousel_slides');
    let parsed: unknown = entry?.value;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { /* not JSON */ }
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      const sanitized = sanitizeCarouselSlides(parsed);
      if (sanitized.length > 0) {
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(sanitized));
          sessionStorage.setItem(CACHE_TS_KEY, String(Date.now()));
        } catch { /* quota exceeded – ignore */ }
        return sanitized;
      }
    }
  } catch (err) {
    console.warn('[HeroCarousel] carousel fetch failed:', err);
  }
  return mockCarouselSlides;
}

function readCachedSlides(): Slide[] | undefined {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as Slide[];
  } catch { /* corrupt cache – ignore */ }
  return undefined;
}

function readCachedTimestamp(): number {
  try {
    const ts = sessionStorage.getItem(CACHE_TS_KEY);
    if (ts) return Number(ts);
  } catch {}
  return 0;
}

const HeroCarousel = () => {
  const queryClient = useQueryClient();
  const { data: slides = mockCarouselSlides } = useQuery({
    queryKey: ['carousel-slides'],
    queryFn: fetchCarouselSlides,
    staleTime: 0,
    initialData: readCachedSlides,
    initialDataUpdatedAt: readCachedTimestamp,
  });

  const [current, setCurrent] = useState(0);
  const [fallbackSrcById, setFallbackSrcById] = useState<Record<string, true>>({});

  useEffect(() => {
    setCurrent(0);
    setFallbackSrcById({});
  }, [slides]);

  useEffect(() => {
    const handleUpdate = () => {
      try {
        sessionStorage.removeItem(CACHE_KEY);
        sessionStorage.removeItem(CACHE_TS_KEY);
      } catch { /* ignore */ }
      queryClient.invalidateQueries({ queryKey: ['carousel-slides'] });
    };
    window.addEventListener('carouselUpdated', handleUpdate);
    return () => window.removeEventListener('carouselUpdated', handleUpdate);
  }, [queryClient]);

  const next = useCallback(() => setCurrent((c) => (c + 1) % slides.length), [slides.length]);
  const prev = useCallback(() => setCurrent((c) => (c - 1 + slides.length) % slides.length), [slides.length]);

  useEffect(() => {
    const timer = setInterval(next, 5000);
    return () => clearInterval(timer);
  }, [next]);

  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: '12/5', maxHeight: '60vh' }}>
      {slides.map((slide, i) => (
        <div
          key={slide.id}
          className={`absolute inset-0 transition-opacity duration-700 ${i === current ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <img
            src={fallbackSrcById[slide.id] ? CAROUSEL_FALLBACK_IMAGE : slide.imageUrl}
            alt={slide.title || ''}
            className="w-full h-full object-cover"
            onError={() => {
              setFallbackSrcById((prev) => (prev[slide.id] ? prev : { ...prev, [slide.id]: true }));
            }}
          />
          <div className="absolute inset-0 bg-hero-overlay" />
          {slide.title && (
            <div className="absolute bottom-12 left-8 md:left-16">
              <h2 className="text-2xl md:text-4xl font-bold drop-shadow-lg animate-slide-up" style={{ color: '#FFF7FB' }}>
                {slide.title}
              </h2>
            </div>
          )}
        </div>
      ))}
      <button onClick={prev} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-primary/50 text-white flex items-center justify-center hover:bg-primary/70 transition-colors">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button onClick={next} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-primary/50 text-white flex items-center justify-center hover:bg-primary/70 transition-colors">
        <ChevronRight className="h-5 w-5" />
      </button>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`w-3 h-3 rounded-full transition-colors ${i === current ? 'bg-secondary' : 'bg-white/50'}`}
          />
        ))}
      </div>
    </div>
  );
};

export default HeroCarousel;
