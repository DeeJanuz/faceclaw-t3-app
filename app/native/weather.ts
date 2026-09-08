export type WeatherPhase = "permission-required" | "locating" | "loading" | "ready" | "error";

export type CurrentWeather = {
  temperatureF: number | null;
  description: string;
  humidityPercent: number | null;
  windSpeedMph: number | null;
  windDirection: string;
  timestampMs: number | null;
  observed: boolean;
};

export type ForecastPeriod = {
  name: string;
  startTimeMs: number;
  temperatureF: number | null;
  shortForecast: string;
  detailedForecast: string;
  precipitationPercent: number | null;
  windSpeed: string;
  windDirection: string;
  isDaytime: boolean;
};

export type WeatherState = {
  phase: WeatherPhase;
  status: string;
  locationName: string;
  current: CurrentWeather | null;
  forecast: ForecastPeriod[];
  lastUpdatedMs: number | null;
};


import { hostState, onHostState } from '../extensions/host';
export const weatherBridge = {
 snapshot: (): WeatherState => hostState.weather ?? {phase:'permission-required',status:'Weather unavailable from host',locationName:'',current:null,forecast:[],lastUpdatedMs:null},
 onStateChange: (listener: () => void) => onHostState(listener),
};
