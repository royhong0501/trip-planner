import { useState, useEffect, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';

export interface PlaceData {
  address: string;
  placeId: string;
  lat: number;
  lng: number;
}

interface Props {
  initialValue?: string;
  onPlaceSelect: (data: PlaceData) => void;
  /** Called when the input loses focus — lets parents persist typed-but-not-selected text. */
  onBlur?: (value: string) => void;
  className?: string;
}

/**
 * Places Autocomplete using the classic google.maps.places API.
 *
 * Uses AutocompleteService (predictions) + PlacesService (details) which are
 * available via traditional script-tag loading with ?libraries=places.
 * No importLibrary() calls — consistent with the rest of the app.
 *
 * Flow:
 *  1. User types → debounced AutocompleteService.getPlacePredictions()
 *  2. Dropdown renders predictions
 *  3. User clicks → PlacesService.getDetails() → onPlaceSelect()
 *  4. Session token refreshed after each completed selection (billing best-practice)
 */
const PlacesAutocomplete = ({ initialValue, onPlaceSelect, onBlur, className }: Props) => {
  const [inputValue, setInputValue]   = useState(initialValue ?? '');
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [isOpen, setIsOpen]           = useState(false);
  const [loading, setLoading]         = useState(false);

  const debounceRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef  = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const containerRef     = useRef<HTMLDivElement>(null);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  useEffect(() => { onPlaceSelectRef.current = onPlaceSelect; });

  // ── Cleanup debounce on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Initialise session token (once, after Maps loads) ────────────────────
  useEffect(() => {
    if (typeof google !== 'undefined' && google.maps?.places?.AutocompleteSessionToken) {
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
    }
  }, []);

  // ── Fetch suggestions (debounced 300 ms) ──────────────────────────────────
  const fetchSuggestions = useCallback((query: string) => {
    if (query.trim().length < 2) { setSuggestions([]); setIsOpen(false); return; }

    setLoading(true);
    try {
      const service = new google.maps.places.AutocompleteService();
      service.getPlacePredictions(
        {
          input: query,
          ...(sessionTokenRef.current ? { sessionToken: sessionTokenRef.current } : {}),
        },
        (predictions, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            setSuggestions(predictions);
            setIsOpen(predictions.length > 0);
          } else {
            setSuggestions([]);
            setIsOpen(false);
          }
          setLoading(false);
        },
      );
    } catch {
      setSuggestions([]);
      setIsOpen(false);
      setLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  // ── Handle suggestion selection ───────────────────────────────────────────
  const handleSelect = (prediction: google.maps.places.AutocompletePrediction) => {
    setIsOpen(false);
    setSuggestions([]);

    // Renew session token for next search (billing best-practice)
    if (typeof google !== 'undefined' && google.maps?.places?.AutocompleteSessionToken) {
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
    }

    // PlacesService requires a DOM element or Map instance
    const detailDiv = document.createElement('div');
    const placesService = new google.maps.places.PlacesService(detailDiv);

    placesService.getDetails(
      {
        placeId: prediction.place_id,
        fields: ['place_id', 'formatted_address', 'geometry', 'name'],
      },
      (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
          const address = place.formatted_address ?? place.name ?? '';
          setInputValue(address);
          onPlaceSelectRef.current({
            placeId: place.place_id ?? '',
            address,
            lat: place.geometry?.location?.lat() ?? 0,
            lng: place.geometry?.location?.lng() ?? 0,
          });
        }
      },
    );
  };

  // ── Close dropdown on outside click ──────────────────────────────────────
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>

      {/* Input with search icon */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-[#5C4F45]" />
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          onBlur={() => onBlur?.(inputValue)}
          placeholder="搜尋地點"
          autoComplete="off"
          className="w-full pl-7 pr-2 py-1.5 rounded border border-[#C4B09A] bg-[#D6C5B3]
                     text-[#5C4F45] text-sm outline-none
                     placeholder:text-[#5C4F45]/60
                     focus:border-[#5C4F45] focus:ring-1 focus:ring-[#5C4F45]
                     transition-colors"
        />
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-[#5C4F45]/30 border-t-[#5C4F45] animate-spin" />
        )}
      </div>

      {/* Suggestions dropdown */}
      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white rounded-lg border border-[#E5DDD5] shadow-lg overflow-hidden py-1">
          {suggestions.map((pred, i) => {
            const main      = pred.structured_formatting?.main_text      ?? pred.description ?? '';
            const secondary = pred.structured_formatting?.secondary_text ?? '';
            return (
              <li
                key={i}
                onMouseDown={() => handleSelect(pred)}
                className="px-3 py-2 cursor-pointer hover:bg-[#F7F3F0] transition-colors"
              >
                <span className="block text-sm font-medium text-[#1F2937] leading-tight">
                  {main}
                </span>
                {secondary && (
                  <span className="block text-xs text-[#6B7280] leading-tight mt-0.5">
                    {secondary}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default PlacesAutocomplete;
