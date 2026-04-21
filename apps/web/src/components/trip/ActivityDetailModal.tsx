import { X, ExternalLink } from 'lucide-react';
import { ActivityCard } from '@/types/trip';

interface Props {
  activity: ActivityCard;
  onClose: () => void;
}

const ActivityDetailModal = ({ activity, onClose }: Props) => {
  // Build a Google Maps search link from the stored coordinates or address text
  const mapsHref = activity.lat && activity.lng
    ? `https://www.google.com/maps/search/?api=1&query=${activity.lat},${activity.lng}${activity.placeId ? `&query_place_id=${activity.placeId}` : ''}`
    : activity.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.address)}`
      : null;

  return (
    <div className="fixed inset-0 z-50 bg-primary/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl animate-slide-up" onClick={(e) => e.stopPropagation()}>
        {/* Header close button */}
        <div className="relative flex justify-end p-3">
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center hover:bg-muted/80">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-foreground">{activity.title}</h3>
            {activity.type && (
              <span className="px-2.5 py-1 bg-secondary/20 text-secondary text-xs rounded-full font-medium">{activity.type}</span>
            )}
          </div>

          {activity.address && (
            <div className="flex items-start gap-2">
              <p className="text-sm text-muted-foreground flex-1">{activity.address}</p>
              {mapsHref && (
                <a href={mapsHref} target="_blank" rel="noopener noreferrer"
                   className="shrink-0 flex items-center gap-1 text-xs text-secondary hover:underline">
                  地圖 <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {activity.notes && (
            <>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">備註</p>
              <div className="rich-html text-sm text-table-foreground" dangerouslySetInnerHTML={{ __html: activity.notes }} />
            </>
          )}

        </div>
      </div>
    </div>
  );
};

export default ActivityDetailModal;
