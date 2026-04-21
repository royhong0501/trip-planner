import TripCard from './TripCard';
import { Plane } from 'lucide-react';
import { Trip } from '@/types/trip';

interface Props {
  trips: Trip[];
  loading?: boolean;
}

const OngoingTripsSection = ({ trips }: Props) => {
  const ongoingTrips = trips.filter((t) => t.status === 'ongoing');

  if (ongoingTrips.length === 0) return null;

  return (
    <section className="pt-10 md:pt-14 pb-2">
      <div className="container mx-auto px-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center">
            <Plane className="h-5 w-5 text-foreground" />
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-foreground">進行中的旅程</h2>
        </div>
        <div className="flex gap-5 overflow-x-auto scrollbar-hide pb-4">
          {ongoingTrips.map((trip) => (
            <div key={trip.id} className="flex-shrink-0">
              <div className="relative">
                <TripCard trip={trip} />
                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-400 text-white shadow">
                  進行中
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default OngoingTripsSection;
