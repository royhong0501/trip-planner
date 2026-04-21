/**
 * Google Maps JavaScript API bootstrap — traditional script-tag loader.
 *
 * Loads places + routes libraries upfront with a single <script> tag.
 * All google.maps.* classes are available synchronously after onload fires.
 * No importLibrary() calls needed anywhere in the app.
 */

let loadPromise: Promise<void> | null = null;

export function loadGoogleMapsApi(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  // Already fully loaded — fast path.
  if (typeof (window as any).google?.maps?.Map === 'function') {
    return loadPromise ?? Promise.resolve();
  }

  // Already loading — reuse the same promise.
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const script       = document.createElement('script');
    // Traditional loading: places + routes bundled in one request, no loading=async.
    // This makes google.maps.Map, google.maps.places.*, google.maps.DirectionsService
    // available directly after onload without any importLibrary() calls.
    script.src         = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,routes&v=weekly`;
    script.async       = true;
    script.defer       = true;
    script.onload      = () => resolve();
    script.onerror     = () => {
      loadPromise = null;
      reject(new Error('Google Maps script failed to load — check the API key and network.'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
