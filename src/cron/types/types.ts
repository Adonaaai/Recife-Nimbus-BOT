// Thresholds
export const T = {
  // accumulated/prolonged totals
  PROLONGED_RAIN_3H_MM: 25,
  PROLONGED_RAIN_24H_MM: 50,
  PROLONGED_RAIN_24H_RED_MM: 100,

  // Rain intensity thresholds
  RAIN_RED_MM: 30,
  RAIN_YELLOW_MM: 15,
  FORECAST_MM: 10,

  // Tides metres.
  TIDE_HIGH_M: 2.0,
  TIDE_EXTREME_M: 2.7,

  // Compound rain and tide.
  COMPOUND_RAIN_MM: 15,
  COMPOUND_TIDE_M: 2.0,

  // forecast compound rain (updated from 2mm to a realistic value)
  FORECAST_COMPOUND_RAIN_MM: 15,

  // Cooldowns for no spamming.
  COOLDOWN_RED_MIN: 60,
  COOLDOWN_YELLOW_MIN: 180,

  // "as const" for never change in the runtime.
} as const;

export type ApacRainValue = number | "-" | null;

// Raw response from /api.php/precipitacao_acumulada.
export interface ApacRainSensor {
  municipio: string;
  codigo_municipio: number;
  estacao: string;
  latitude: number;
  longitude: number;
  bacia: string;
  codigo_estacao: string;
  data_hora_ultima_leitura: string | null;
  precipitacao: number | null;
  ultima_medicao: number | null;
  "1_hora": ApacRainValue;
  "3_horas": ApacRainValue;
  "6_horas": ApacRainValue;
  "12_horas": ApacRainValue;
  "24_horas": ApacRainValue;
  "48_horas": ApacRainValue;
  "72_horas": ApacRainValue;
  "96_horas": ApacRainValue;
  "120_horas": ApacRainValue;
}

// Normalized rain sensor used by the risk engine.
export interface RainSensor {
  estacao: string,
  bacia: string,
  municipio: string;
  "1_hora": number;
  "3_horas": number;
  "3_hora": number;
  "24_horas": number;
  "24_hora": number;
};

// Raw response from /api.php/monitoramento_rios.
export interface ApacRiverSensor {
  id: number;
  estacao: string;
  codigo_estacao: number | string;
  nome_rio: string;
  datacoleta: string;
  horacoleta: string;
  nivel_atual: number;
  nivel_pre_alerta: number;
  nivel_alerta: number;
  nivel_inundacao: number;
  alert_pcd: string;
  data_hora_leitura: string | null;
  nome_bacia: string;
  id_bacia_hidrografica: number;
  river_id: string;
  alerta_validade: string | null;
  inundacao_validade: string | null;
  recente: 0 | 1;
  latitude: number;
  longitude: number;
  codigo_municipio: string;
  tendencia: "S" | "D" | "E" | string;
}

// River sensors interface for predict APAC fluviometer API.
export interface RiverSensor {
  estacao: string;
  nome_bacia: string;
  nivel_atual: number;
  nivel_pre_alerta: number;
  nivel_alerta: number;
  nivel_inundacao: number;
  tendencia: string;        // "S" | "D" | "M"
  situacao: string;         // "Normal" | "Pré-alerta" | "Alerta" | "Inundação"
  recente: 0 | 1;           // 1 if the sensor is recent, 0 if not.
};

export type Severity = 'NONE' | 'YELLOW' | 'RED';

// This interface help us build the telegram message.
export interface ZoneRisk {
  severity: Severity;
  maxRainMm: number;
  prolongedRain3h: number;
  prolongedRain24h: number;
  riverSituacao: string | null; // null if doesn't exist river in this zone.
  riverTendencia: string | null
  tideHeight: number;
  forecastMm: number;
  forecastTide: number; // 3 next hours Tide height
  reasons: string[]; // Example: ["Chuva intensa: 35mm/h", "Maré alta: 2.3m"]
};

// typed dictionary
export const TREND_LABEL: Record<string, string> = {
  'S': '↑ subindo',
  'M': '→ estável',
  'D': '↓ descendo',
};

export const SEVERITY_ORDER = {
  "Normal": 0,
  "Pré-alerta": 1,
  'Alerta':     2,
  "Inundação": 3
};

export const OfflineSensorsNormalize = {
  "-": 0
};
