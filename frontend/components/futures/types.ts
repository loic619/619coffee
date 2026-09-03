// Shared shapes for the Futures tab. Extracted from app/futures/page.tsx when
// that file was split — it had grown to 1,084 lines across three sub-tabs, FND
// maths, grade differentials, packaging and certification adders, and every
// change to the most-visited tab was slower than it needed to be.
export interface Contract {
  contract: string;
  expiry: string;
  last: number;
  chg: number;
  oi: number;
  volume: number;
  symbol: string;
}

export interface ChainData { pub_date: string; contracts: Contract[]; }

export const MONTH_ABB = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] as const;
