import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Trash2, ChevronDown, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  searchCityPreview,
  fetchWeatherWithCache,
  fetchWeatherByCoordsWithCache,
  formatTrackedCityLabel,
  normalizeCityKey,
  parseTrackedCityLabel,
  groupForecastByDay,
  formatForecastTime,
  type GeoCityHit,
  type WeatherBundle,
} from '@/lib/weather';

interface Props {
  weatherCities: string[];
  onWeatherCitiesChange: (next: string[]) => void;
}

export default function TripWeatherSidebar({ weatherCities, onWeatherCitiesChange }: Props) {
  const [search, setSearch] = useState('');
  const [previewHit, setPreviewHit] = useState<GeoCityHit | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchEmpty, setSearchEmpty] = useState(false);
  const [weatherByCity, setWeatherByCity] = useState<Record<string, WeatherBundle | null>>({});
  const [loadingWeather, setLoadingWeather] = useState(false);
  /** 同時僅展開一個城市的詳細預報 */
  const [expandedCity, setExpandedCity] = useState<string | null>(null);

  // OpenWeather key now lives server-side (see lib/weather.ts header). The
  // browser can't see it, so we always allow the UI; failures surface as
  // empty results from the /api/weather endpoints instead.
  const hasKey = true;

  const loadAllWeather = useCallback(async (cities: string[]) => {
    if (!hasKey || cities.length === 0) {
      setWeatherByCity({});
      return;
    }
    setLoadingWeather(true);
    try {
      const next: Record<string, WeatherBundle | null> = {};
      await Promise.all(
        cities.map(async (city) => {
          try {
            next[city] = await fetchWeatherWithCache(city);
          } catch {
            next[city] = null;
          }
        }),
      );
      setWeatherByCity(next);
    } finally {
      setLoadingWeather(false);
    }
  }, [hasKey]);

  useEffect(() => {
    void loadAllWeather(weatherCities);
  }, [weatherCities, loadAllWeather]);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasKey || !search.trim()) return;
    setSearchLoading(true);
    setPreviewHit(null);
    setSearchEmpty(false);
    try {
      const hits = await searchCityPreview(search);
      setPreviewHit(hits[0] ?? null);
      setSearchEmpty(hits.length === 0);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAddTracked = async () => {
    if (!previewHit || !hasKey) return;
    const label = formatTrackedCityLabel(previewHit);
    const exists = weatherCities.some((c) => normalizeCityKey(c) === normalizeCityKey(label));
    if (exists) return;

    onWeatherCitiesChange([...weatherCities, label]);
    setPreviewHit(null);
    setSearch('');

    try {
      const data = await fetchWeatherByCoordsWithCache(previewHit.lat, previewHit.lon, label);
      setWeatherByCity((prev) => ({ ...prev, [label]: data }));
    } catch {
      setWeatherByCity((prev) => ({ ...prev, [label]: null }));
    }
  };

  const handleRemove = (city: string) => {
    onWeatherCitiesChange(weatherCities.filter((c) => c !== city));
    setWeatherByCity((prev) => {
      const n = { ...prev };
      delete n[city];
      return n;
    });
    setExpandedCity((prev) => (prev === city ? null : prev));
  };

  const toggleExpand = (city: string) => {
    setExpandedCity((prev) => (prev === city ? null : city));
  };

  return (
    <aside className="w-full rounded-xl border border-border/50 bg-background/60 backdrop-blur-md shadow-sm p-4 min-w-0 max-w-full">
      <h3 className="font-semibold text-foreground mb-3">天氣追蹤</h3>

      {!hasKey && (
        <p className="text-xs text-muted-foreground mb-3">
          請在專案根目錄 `.env` 設定 <code className="text-[10px]">VITE_WEATHER_API_KEY</code>（OpenWeather API Key）以啟用天氣。
        </p>
      )}

      <form onSubmit={handleSearchSubmit} className="space-y-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋城市（Enter 預覽）"
          disabled={!hasKey}
          className="w-full text-sm px-3 py-2.5 rounded-lg border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        />
      </form>

      {searchLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
          <Loader2 className="h-4 w-4 animate-spin" />
          搜尋中…
        </div>
      )}

      {searchEmpty && hasKey && !searchLoading && (
        <p className="text-xs text-muted-foreground mb-3">找不到符合的城市，請換個關鍵字試試。</p>
      )}

      {previewHit && hasKey && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 mb-4 text-sm">
          <p className="font-medium text-foreground">{formatTrackedCityLabel(previewHit)}</p>
          {previewHit.state && <p className="text-xs text-muted-foreground">{previewHit.state}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            {previewHit.lat.toFixed(2)}, {previewHit.lon.toFixed(2)}
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3 w-full"
            disabled={weatherCities.some(
              (c) => normalizeCityKey(c) === normalizeCityKey(formatTrackedCityLabel(previewHit)),
            )}
            onClick={() => void handleAddTracked()}
          >
            <Plus className="h-4 w-4 mr-1" />
            追蹤此城市
          </Button>
        </div>
      )}

      {loadingWeather && weatherCities.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          更新天氣…
        </div>
      )}

      {weatherCities.length === 0 ? (
        <p className="text-sm text-muted-foreground">尚未追蹤任何城市</p>
      ) : (
        <div
          className="flex gap-3 overflow-x-auto overflow-y-visible pb-2 -mx-1 px-1 snap-x snap-mandatory [-webkit-overflow-scrolling:touch]"
          role="list"
          aria-label="追蹤城市天氣（可左右滑動）"
        >
          {weatherCities.map((city) => {
            // Three states:
            //   undefined  → city not yet in map → still loading
            //   null       → fetch completed but failed (404 / network error)
            //   WeatherBundle → success
            const inMap  = city in weatherByCity;
            const bundle = weatherByCity[city];   // null | WeatherBundle when inMap
            const w      = bundle?.current;
            const { cityName, countryCode } = parseTrackedCityLabel(city);
            const isOpen = expandedCity === city;
            const dayGroups = bundle?.forecast48h?.length
              ? groupForecastByDay(bundle.forecast48h)
              : [];

            return (
              <div
                key={city}
                className="min-w-[220px] max-w-[260px] shrink-0 snap-start rounded-lg border border-border/80 bg-card/80 overflow-hidden"
              >
                {/* 收納態：主資訊（點擊區不含刪除） */}
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{cityName}</p>
                      {countryCode && (
                        <p className="text-xs text-muted-foreground mt-0.5">{countryCode}</p>
                      )}
                      {!inMap ? (
                        /* Loading: city added but fetch not yet settled */
                        <div className="flex items-center gap-2 mt-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-xs">載入中…</span>
                        </div>
                      ) : !bundle ? (
                        /* Error: fetch returned null (404 / network error) */
                        <div className="flex items-center gap-1.5 mt-2 text-muted-foreground">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span className="text-xs">暫無資料</span>
                        </div>
                      ) : (
                        /* Success */
                        <>
                          <div className="flex items-center gap-2 mt-2">
                            <img src={w!.iconUrl} alt="" className="h-12 w-12 shrink-0" />
                            <span className="text-2xl font-semibold tabular-nums">
                              {Number.isFinite(w!.tempC) ? `${Math.round(w!.tempC)}°` : '—'}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 capitalize">{w!.description}</p>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(city);
                      }}
                      className="shrink-0 p-2 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10"
                      aria-label={`刪除 ${city}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Only show forecast toggle when data is available */}
                  {inMap && bundle && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(city)}
                      className="mt-3 w-full flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm text-secondary hover:bg-muted/50 transition-colors"
                    >
                      <span>查看詳細預報</span>
                      <ChevronDown
                        className={cn('h-4 w-4 shrink-0 transition-transform duration-300', isOpen && 'rotate-180')}
                      />
                    </button>
                  )}
                </div>

                {/* 展開：垂直預報清單 + 動畫 */}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-300 ease-in-out',
                    isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="border-t border-border/60 bg-black/[0.03] dark:bg-white/[0.05]">
                      {bundle && dayGroups.length > 0 ? (
                        <div className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain">
                          {dayGroups.map((group) => (
                            <div key={group.dayKey} className="border-b border-border/40 last:border-b-0">
                              <div className="sticky top-0 z-[1] bg-muted/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur-sm">
                                {group.label}
                              </div>
                              {group.items.map((it) => (
                                <div
                                  key={`${group.dayKey}-${it.dt}`}
                                  className="flex items-center gap-2 px-3 py-2 text-xs border-b border-border/30 last:border-b-0 min-w-0 overflow-x-hidden"
                                >
                                  <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                                    {formatForecastTime(it.dt)}
                                  </span>
                                  <img src={it.iconUrl} alt="" className="h-7 w-7 shrink-0" />
                                  <span className="flex-1 min-w-0 text-foreground/90 leading-snug break-words">
                                    {it.description}
                                  </span>
                                  <span className="shrink-0 tabular-nums font-medium">
                                    {Number.isFinite(it.tempC) ? `${Math.round(it.tempC)}°` : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : bundle ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">暫無預報資料</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
