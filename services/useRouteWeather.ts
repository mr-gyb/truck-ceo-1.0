import { useEffect, useState } from 'react';
import { getRouteCoordinates } from './routeCoordinates';

export interface RouteWeatherDay {
  date: string; // YYYY-MM-DD (America/New_York)
  tempMax: number; // °F
  weatherCode: number; // WMO weathercode
  precipProb: number; // 0-100
}

export type WeatherCondition = 'Sunny' | 'Cloudy' | 'Rainy' | 'Snow';

// WMO weathercode -> display condition
export function weatherCodeToCondition(code: number): WeatherCondition {
  if (code === 0 || code === 1) return 'Sunny';
  if (code === 2 || code === 3 || code === 45 || code === 48) return 'Cloudy';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
  return 'Rainy'; // drizzle (51-57), rain (61-67, 80-82), thunderstorms (95-99)
}

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

export function useRouteWeather(routeName: string | null): {
  days: Array<{ date: string; tempMax: number; weatherCode: number; precipProb: number }>;
  loading: boolean;
  error: string | null;
} {
  const [days, setDays] = useState<RouteWeatherDay[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routeName) {
      setDays([]);
      setLoading(false);
      setError(null);
      return;
    }

    const { latitude, longitude } = getRouteCoordinates(routeName);
    const url =
      `${BASE_URL}?latitude=${latitude}&longitude=${longitude}` +
      `&daily=temperature_2m_max,weathercode,precipitation_probability_max` +
      `&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=14`;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const daily = data?.daily;
        if (!daily || !Array.isArray(daily.time)) {
          throw new Error('Unexpected weather response');
        }
        const mapped: RouteWeatherDay[] = daily.time.map((date: string, i: number) => {
          const tempMax = Math.round(Number(daily.temperature_2m_max?.[i]));
          if (!Number.isFinite(tempMax)) {
            throw new Error('Incomplete weather data');
          }
          return {
            date,
            tempMax,
            weatherCode: Number(daily.weathercode?.[i] ?? -1),
            precipProb: Math.max(0, Math.min(100, Math.round(Number(daily.precipitation_probability_max?.[i] ?? 0)))),
          };
        });
        setDays(mapped);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // Never fall back to invented numbers — surface the failure honestly.
        setError(err instanceof Error ? err.message : 'Weather unavailable');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [routeName]);

  return { days, loading, error };
}
