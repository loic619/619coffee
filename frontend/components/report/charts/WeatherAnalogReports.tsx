"use client";
/**
 * Report wrappers for the weather-analog visuals. Each origin's panel is
 * broken into its parts (backtest, ensembles, signature, stage rain, stage
 * ONI, analog table) so a report can carry the forecast without the whole
 * methodology block. AnalogSection self-fetches the origin's JSON.
 */
import { AnalogSection, type AnalogPart } from "@/components/supply/WeatherAnalogs";

export const ANALOG_ORIGINS = {
  brazil:  { dataUrl: "/data/weather_analogs_brazil.json",  label: "Brazil arabica" },
  vietnam: { dataUrl: "/data/weather_analogs_vietnam.json", label: "Vietnam robusta" },
} as const;

export const ANALOG_PARTS: AnalogPart[] = ["ensemble", "backtest", "signature", "stage_rain", "stage_oni", "table"];

function part(origin: keyof typeof ANALOG_ORIGINS, p: AnalogPart) {
  const o = ANALOG_ORIGINS[origin];
  const C = () => <AnalogSection dataUrl={o.dataUrl} label={o.label} part={p} />;
  C.displayName = `Analog_${origin}_${p}`;
  return C;
}

export const BrazilAnalogEnsemble   = part("brazil", "ensemble");
export const BrazilAnalogBacktest   = part("brazil", "backtest");
export const BrazilAnalogSignature  = part("brazil", "signature");
export const BrazilAnalogStageRain  = part("brazil", "stage_rain");
export const BrazilAnalogStageOni   = part("brazil", "stage_oni");
export const BrazilAnalogTable      = part("brazil", "table");

export const VietnamAnalogEnsemble  = part("vietnam", "ensemble");
export const VietnamAnalogBacktest  = part("vietnam", "backtest");
export const VietnamAnalogSignature = part("vietnam", "signature");
export const VietnamAnalogStageRain = part("vietnam", "stage_rain");
export const VietnamAnalogStageOni  = part("vietnam", "stage_oni");
export const VietnamAnalogTable     = part("vietnam", "table");
