import { useNavigate } from 'react-router-dom';
import { Image } from 'lucide-react';
import { Trip } from '@/types/trip';

interface TripCardProps {
  trip: Trip;
}

const TripCard = ({ trip }: TripCardProps) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/trip/${trip.id}`)}
      className="group flex-shrink-0 w-48 md:w-56 text-left"
    >
      <div className="relative overflow-hidden rounded-lg aspect-[3/2] mb-2">
        {trip.coverImage ? (
          <img
            src={trip.coverImage}
            alt={trip.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center bg-muted group-hover:scale-105 transition-transform duration-300"
            aria-hidden
          >
            <Image className="h-10 w-10 text-muted-foreground/50" />
          </div>
        )}
      </div>
      <h3 className="font-medium text-foreground group-hover:text-secondary transition-colors truncate">
        {trip.title}
      </h3>
      <p className="text-sm text-muted-foreground">
        {trip.startDate} ~ {trip.endDate}
      </p>
    </button>
  );
};

export default TripCard;
