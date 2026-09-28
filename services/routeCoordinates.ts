// Real territory coordinates for every TruckCEO route (CT/NY).
// Matches case-insensitively on the route number or the town name,
// so it works whether the route is named "0721 Yonkers", "0721", or "Yonkers".

interface TerritoryCoord {
  latitude: number;
  longitude: number;
  label: string;
}

const TERRITORIES: Array<{ numbers: string[]; towns: string[]; coord: TerritoryCoord }> = [
  { numbers: ['0721'], towns: ['yonkers'], coord: { latitude: 40.9312, longitude: -73.8987, label: 'Yonkers NY' } },
  { numbers: ['1612'], towns: ['ossining'], coord: { latitude: 41.1621, longitude: -73.8612, label: 'Ossining NY' } },
  { numbers: ['1510'], towns: ['norwalk'], coord: { latitude: 41.1177, longitude: -73.4128, label: 'Norwalk CT' } },
  { numbers: ['2080'], towns: ['stamford'], coord: { latitude: 41.0534, longitude: -73.5387, label: 'Stamford CT' } },
  { numbers: ['2286'], towns: ['ridgefield'], coord: { latitude: 41.2816, longitude: -73.4982, label: 'Ridgefield CT' } },
  { numbers: ['6286'], towns: ['danbury'], coord: { latitude: 41.3948, longitude: -73.4540, label: 'Danbury CT' } },
  { numbers: ['7823'], towns: ['stratford'], coord: { latitude: 41.1845, longitude: -73.1330, label: 'Stratford CT' } },
  { numbers: ['13445'], towns: ['milford'], coord: { latitude: 41.2307, longitude: -73.0641, label: 'Milford CT' } },
];

const FALLBACK: TerritoryCoord = {
  latitude: 41.0534,
  longitude: -73.5387,
  label: 'Stamford CT (default)',
};

export function getRouteCoordinates(routeName: string): { latitude: number; longitude: number; label: string } {
  const name = (routeName || '').toLowerCase();
  for (const t of TERRITORIES) {
    if (t.numbers.some((n) => name.includes(n)) || t.towns.some((town) => name.includes(town))) {
      return { ...t.coord };
    }
  }
  return { ...FALLBACK };
}
