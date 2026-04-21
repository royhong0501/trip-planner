import { Trip, CarouselSlide, AdminUser } from '@/types/trip';

export const mockCarouselSlides: CarouselSlide[] = [
  { id: '1', imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=1200&h=800&fit=crop', title: '探索世界的美' },
  { id: '2', imageUrl: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&h=800&fit=crop', title: '踏上新的旅程' },
  { id: '3', imageUrl: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1200&h=800&fit=crop', title: '記錄每一刻感動' },
];

export const mockTrips: Trip[] = [
  {
    id: '1',
    title: '東京五日遊',
    coverImage: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&h=400&fit=crop',
    startDate: '2026-04-01',
    endDate: '2026-04-05',
    category: 'international',
    status: 'planning',
    todos: [
      { id: 't1', text: '訂機票', checked: true },
      { id: 't2', text: '訂飯店', checked: true },
      { id: 't3', text: '換日幣', checked: false },
      { id: 't4', text: '買旅遊保險', checked: false },
    ],
    flights: {
      departure: { airline: '中華航空', flightNumber: 'CI100', departureTime: '2026-04-01 08:00', arrivalTime: '2026-04-01 12:00', departureAirport: '桃園國際機場 TPE', arrivalAirport: '成田國際機場 NRT', checkedBaggage: 23, carryOnBaggage: 7 },
      return: { airline: '中華航空', flightNumber: 'CI101', departureTime: '2026-04-05 14:00', arrivalTime: '2026-04-05 17:00', departureAirport: '成田國際機場 NRT', arrivalAirport: '桃園國際機場 TPE', checkedBaggage: 23, carryOnBaggage: 7 },
    },
    hotels: [
      { id: 'h1', name: '新宿華盛頓飯店', checkIn: '2026-04-01', checkOut: '2026-04-03', address: '東京都新宿區西新宿3-2-9', confirmationNumber: 'HT-20260401' },
      { id: 'h2', name: '淺草豪景飯店', checkIn: '2026-04-03', checkOut: '2026-04-05', address: '東京都台東區西淺草3-17-1', confirmationNumber: 'HT-20260403' },
    ],
    dailyItineraries: [
      {
        date: '2026-04-01',
        activities: [
          { id: 'a1', title: '一蘭拉麵 新宿店', type: '美食', address: '東京都新宿區歌舞伎町1-22-7', notes: '必吃豚骨拉麵' },
        ],
      },
      {
        date: '2026-04-02',
        activities: [
          { id: 'a2', title: '明治神宮', type: '景點', address: '東京都澀谷區代代木神園町1-1', notes: '<p>日本最著名的神社之一</p>' },
          { id: 'a3', title: '竹下通', type: '購物', address: '東京都澀谷區神宮前1', notes: '' },
        ],
      },
      {
        date: '2026-04-03',
        activities: [
          { id: 'a4', title: '淺草寺', type: '景點', address: '東京都台東區淺草2-3-1', notes: '' },
        ],
      },
    ],
    luggageList: [
      { id: 'l1', name: '衣物', items: [{ id: 'li1', text: 'T恤 x3', checked: false }, { id: 'li2', text: '外套', checked: true }] },
      { id: 'l2', name: '電子產品', items: [{ id: 'li3', text: '充電器', checked: false }, { id: 'li4', text: '行動電源', checked: false }] },
    ],
    shoppingList: [
      { id: 's1', status: 'incomplete', name: '日本藥妝', location: '松本清', price: 3000 },
      { id: 's2', status: 'complete', name: '抹茶零食', location: '東京車站', price: 1500 },
    ],
    otherNotes: '',
    weatherCities: [],
  },
  {
    id: '2',
    title: '花蓮三日遊',
    coverImage: 'https://images.unsplash.com/photo-1504681869696-d977211a5f4c?w=600&h=400&fit=crop',
    startDate: '2026-03-15',
    endDate: '2026-03-17',
    category: 'domestic',
    status: 'ongoing',
    todos: [{ id: 't5', text: '預約賞鯨', checked: false }],
    flights: { departure: { airline: '', flightNumber: '', departureTime: '', arrivalTime: '', departureAirport: '', arrivalAirport: '', checkedBaggage: 0, carryOnBaggage: 0 }, return: { airline: '', flightNumber: '', departureTime: '', arrivalTime: '', departureAirport: '', arrivalAirport: '', checkedBaggage: 0, carryOnBaggage: 0 } },
    hotels: [{ id: 'h3', name: '花蓮煙波大飯店', checkIn: '2026-03-15', checkOut: '2026-03-17', address: '花蓮縣花蓮市中美路142號', confirmationNumber: 'FL-001' }],
    dailyItineraries: [
      { date: '2026-03-15', activities: [{ id: 'a5', title: '太魯閣國家公園', type: '景點', address: '花蓮縣秀林鄉富世291號', notes: '' }] },
    ],
    luggageList: [],
    shoppingList: [],
    otherNotes: '',
    weatherCities: [],
  },
  {
    id: '3',
    title: '京都大阪七日遊',
    coverImage: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=600&h=400&fit=crop',
    startDate: '2025-11-01',
    endDate: '2025-11-07',
    category: 'international',
    status: 'completed',
    todos: [],
    flights: { departure: { airline: '日本航空', flightNumber: 'JL802', departureTime: '2025-11-01 09:00', arrivalTime: '2025-11-01 13:00', departureAirport: '桃園國際機場 TPE', arrivalAirport: '關西國際機場 KIX', checkedBaggage: 23, carryOnBaggage: 7 }, return: { airline: '日本航空', flightNumber: 'JL803', departureTime: '2025-11-07 15:00', arrivalTime: '2025-11-07 18:00', departureAirport: '關西國際機場 KIX', arrivalAirport: '桃園國際機場 TPE', checkedBaggage: 23, carryOnBaggage: 7 } },
    hotels: [],
    dailyItineraries: [],
    luggageList: [],
    shoppingList: [],
    otherNotes: '',
    weatherCities: [],
  },
  {
    id: '4',
    title: '墾丁兩日遊',
    coverImage: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&h=400&fit=crop',
    startDate: '2025-12-20',
    endDate: '2025-12-21',
    category: 'domestic',
    status: 'completed',
    todos: [],
    flights: { departure: { airline: '', flightNumber: '', departureTime: '', arrivalTime: '', departureAirport: '', arrivalAirport: '', checkedBaggage: 0, carryOnBaggage: 0 }, return: { airline: '', flightNumber: '', departureTime: '', arrivalTime: '', departureAirport: '', arrivalAirport: '', checkedBaggage: 0, carryOnBaggage: 0 } },
    hotels: [],
    dailyItineraries: [],
    luggageList: [],
    shoppingList: [],
    otherNotes: '',
    weatherCities: [],
  },
];

export const mockAdminUsers: AdminUser[] = [
  { username: 'admin', password: 'admin123' },
];

export const introVideoUrl = 'https://videos.pexels.com/video-files/3571264/3571264-uhd_2560_1440_30fps.mp4';
