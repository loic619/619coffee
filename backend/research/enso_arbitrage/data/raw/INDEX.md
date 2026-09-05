# Raw external files — what landed

_Generated 2026-09-05T15:30:41Z by fetch_external.py. Previews only; the study reads these through `load_external.py`._


## data/raw/worldbank_pink_sheet_current/CMO-Historical-Data-Monthly.xlsx

- source `worldbank_pink_sheet_current` · 586735 B · sha256 `9fdcfa8a2aed9a1b…`
- url: https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx
- note: World Bank CMO 'Pink Sheet', latest monthly release (approved). · link text: Monthly prices

```
  sheet `Mismatch Details` max_row=156
    MISMATCH DETAILS |  |  |  |  |  | 
    Exact cell-by-cell |  |  |  |  |  | 
     |  |  |  |  |  | 
    Period | Commodity | Current Cell | Current Display | Uploaded Cell | Uploaded Display | Difference Type
    2020M09 | Barley | AD736 | (blank) | AD735 | 80.4 | Blank vs number
    2020M09 | Sorghum | AF736 | (blank) | AF735 | 189.6 | Blank vs number
    2020M10 | Barley | AD737 | (blank) | AD736 | 80.5 | Blank vs number
    2020M10 | Sorghum | AF737 | (blank) | AF736 | 189.6 | Blank vs number
  sheet `Monthly Prices` max_row=806
    World Bank Commodi |  |  |  |  |  |  |  |  |  |  | 
    monthly prices in  |  |  |  |  |  |  |  |  |  |  | 
    (monthly series ar |  |  |  |  |  |  |  |  |  |  | 
    Updated on Septemb |  |  |  |  |  |  |  |  |  |  | 
     | Crude oil, average | Crude oil, Brent | Crude oil, Dubai | Crude oil, WTI | Coal, Australian | Coal, South Africa | Natural gas, US | Natural gas, Europ | Liquefied natural  | Natural gas index | Cocoa
     | ($/bbl) | ($/bbl) | ($/bbl) | ($/bbl) | ($/mt) | ($/mt) | ($/mmbtu) | ($/mmbtu) | ($/mmbtu) | (2010=100) | ($/kg)
    1960M01 | 1.6 | 1.6 | 1.6 | … | … | … | 0.14 | 0.4 | … | … | 0.63
    1960M02 | 1.6 | 1.6 | 1.6 | … | … | … | 0.14 | 0.4 | … | … | 0.61
  sheet `Monthly Indices` max_row=1362
    World Bank Commodi |  |  |  |  |  |  |  |  |  |  | 
    monthly indices ba |  |  |  |  |  |  |  |  |  |  | 
    (monthly series ar |  |  |  |  |  |  |  |  |  |  | 
    Updated on Septemb |  |  |  |  |  |  |  |  |  |  | 
     |  |  |  |  |  |  |  |  |  |  | 
     | Total Index | Energy | Non-energy ** |  |  |  |  |  |  |  | 
     |  |  |  | Agriculture ** |  |  |  |  |  |  | 
     |  |  |  |  | Beverages | Food ** |  |  |  | Raw Materials | 
  sheet `Description` max_row=410
    World Bank Commodi |  |  |  |  |  |  |  |  |  |  | 
    Series Description |  |  |  |  |  |  |  |  |  |  | 
    Energy |  |  |  |  |  |  |  |  |  |  | 
       * | Coal (Australia),  |  |  |  |  |  |  |  |  |  | 
     | Coal (Colombia), t |  |  |  |  |  |  |  |  |  | 
     | Coal (South Africa |  |  |  |  |  |  |  |  |  | 
       * | Crude oil, average |  |  |  |  |  |  |  |  |  | 
     | Crude oil, UK Bren |  |  |  |  |  |  |  |  |  | 
  sheet `Index Weights` max_row=92
    Weights Used in th |  |  |  |  |  |  |  |  |  |  | 
    based on 2002-04 d |  |  |  |  |  |  |  |  |  |  | 
     |  | Commodity Group |  |  |  |  |  | Share of
energy an |  |  | Share of
sub-group
     |  | Total Index |  |  |  |  |  | 100 |  |  | 
     |  |  | Energy |  |  |  |  | 67 |  |  | 
     |  |  | Non-Energy |  |  |  |  | 33 |  |  | 
     |  |  |  |  |  |  |  |  |  |  | 
     | Energy |  |  |  |  |  |  | 100 |  |  | 100
```

## data/raw/worldbank_pink_sheet_monthly/CMO-Historical-Data-Monthly.xlsx

- source `worldbank_pink_sheet_monthly` · 765246 B · sha256 `bd89b83eeceadaec…`
- url: https://thedocs.worldbank.org/en/doc/5d903e848db1d1b83e0ec8f744e55570-0350012021/related/CMO-Historical-Data-Monthly.xlsx
- note: World Bank CMO 'Pink Sheet', monthly, 1960→: COFFEE_ARABIC / COFFEE_ROBUS (approved). Jan-2025 snapshot.

```
  sheet `AFOSHEET` max_row=1
  sheet `Monthly Prices` max_row=786
    World Bank Commodi |  |  |  |  |  |  |  |  |  |  | 
    monthly prices in  |  |  |  |  |  |  |  |  |  |  | 
    (monthly series ar |  |  |  |  |  |  |  |  |  |  | 
    Updated on January |  |  |  |  |  |  |  |  |  |  | 
     | Crude oil, average | Crude oil, Brent | Crude oil, Dubai | Crude oil, WTI | Coal, Australian | Coal, South Africa | Natural gas, US | Natural gas, Europ | Liquefied natural  | Natural gas index | Cocoa
     | ($/bbl) | ($/bbl) | ($/bbl) | ($/bbl) | ($/mt) | ($/mt) | ($/mmbtu) | ($/mmbtu) | ($/mmbtu) | (2010=100) | ($/kg)
    1960M01 | 1.63000011444 | 1.63000011444 | 1.63000011444 | … | … | … | 0.14 | 0.40477399635 | … | … | 0.634
    1960M02 | 1.63000011444 | 1.63000011444 | 1.63000011444 | … | … | … | 0.14 | 0.40477399635 | … | … | 0.608
  sheet `Monthly Indices` max_row=1362
    World Bank Commodi |  |  |  |  |  |  |  |  |  |  | 
    monthly indices ba |  |  |  |  |  |  |  |  |  |  | 
    (monthly series ar |  |  |  |  |  |  |  |  |  |  | 
    Updated on January |  |  |  |  |  |  |  |  |  |  | 
     |  |  |  |  |  |  |  |  |  |  | 
     | Total Index | Energy | Non-energy ** |  |  |  |  |  |  |  | 
     |  |  |  | Agriculture ** |  |  |  |  |  |  | 
     |  |  |  |  | Beverages | Food ** |  |  |  | Raw Materials | 
  sheet `Description` max_row=400
    World Bank Commodi |  |  |  |  |  |  |  |  |  |  | 
    Series Description |  |  |  |  |  |  |  |  |  |  | 
    Energy |  |  |  |  |  |  |  |  |  |  | 
       * | Coal (Australia),  |  |  |  |  |  |  |  |  |  | 
     | Coal (Colombia), t |  |  |  |  |  |  |  |  |  | 
     | Coal (South Africa |  |  |  |  |  |  |  |  |  | 
       * | Crude oil, average |  |  |  |  |  |  |  |  |  | 
     | Crude oil, UK Bren |  |  |  |  |  |  |  |  |  | 
  sheet `Index Weights` max_row=92
    Weights Used in th |  |  |  |  |  |  |  |  |  |  | 
    based on 2002-04 d |  |  |  |  |  |  |  |  |  |  | 
     |  | Commodity Group |  |  |  |  |  | Share of
energy an |  |  | Share of
sub-group
     |  | Total Index |  |  |  |  |  | 100 |  |  | 
     |  |  | Energy |  |  |  |  | 67 |  |  | 
     |  |  | Non-Energy |  |  |  |  | 33 |  |  | 
     |  |  |  |  |  |  |  |  |  |  | 
     | Energy |  |  |  |  |  |  | 100 |  |  | 100
```

## Not retrieved

- `ico_historical` 404 text/html; charset=UTF-8 — https://www.ico.org/new_historical.asp
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/new_historical.asp
- `ico_historical` 404 text/html; charset=UTF-8 — https://www.ico.org/coffee_prices.asp
- `ico_historical` 404 text/html; charset=UTF-8 — https://www.ico.org/prices/
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/1a%20-%20Total%20production.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/1a-total-production.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/1b%20-%20Domestic%20consumption.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/1b-domestic-consumption.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/1d%20-%20Gross%20Opening%20stocks.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/1d-gross-opening-stocks.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/1e%20-%20Exports%20-%20crop%20year.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/1e-exports.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/2a%20-%20Exports%20-%20calendar%20year.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/2a-exports.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/2b%20-%20Imports.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/2b-imports.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/2c%20-%20Re-exports.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/2c-re-exports.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/3a%20-%20Prices%20paid%20to%20growers.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/3a-prices-growers.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/3b%20-%20Retail%20prices.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/3b-retail-prices.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/3c%20-%20Indicator%20prices.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/3c-indicator-prices.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/4a%20-%20Inventories.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/4a-inventories.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/4b%20-%20Disappearance.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/4b-disappearance.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/5a%20-%20Non-member%20imports.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/5a-imports-non-members.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/Excel/5b%20-%20Non-member%20re-exports.xlsx
- `ico_historical` 404 text/html; charset=UTF-8 — https://ico.org/historical/1990%20onwards/PDF/5b-re-exports-non-members.pdf
- `ico_historical` 404 text/html; charset=UTF-8 — https://icocoffee.org/resources/coffee-prices/
- `ico_historical` 403 text/html; charset=iso-8859-1 — https://icocoffee.org/documents/
- `ico_direct` 404 text/html; charset=UTF-8 — https://www.ico.org/historical/1990%20onwards/Excel/3a%20-%20Prices%20paid%20to%20growers.xlsx
- `ico_direct` 404 text/html; charset=UTF-8 — https://www.ico.org/historical/1990%20onwards/Excel/3b%20-%20Retail%20prices.xlsx
- `ico_direct` 404 text/html; charset=UTF-8 — https://www.ico.org/historical/1990%20onwards/Excel/2a%20-%20Prices%20paid%20to%20growers.xlsx
- `ico_direct` 404 text/html; charset=UTF-8 — https://www.ico.org/historical/1990%20onwards/Excel/1a%20-%20Total%20production.xlsx
- `ico_direct` 404 text/html; charset=UTF-8 — https://www.ico.org/historical/1990%20onwards/Excel/1e%20-%20Exports%20-%20crop%20year.xlsx
- `ico_direct` 404 text/html; charset=UTF-8 — https://www.ico.org/prices/pr-prices.pdf
- `stooq_kc_f_daily` 200 text/html; charset=utf-8 — https://stooq.com/q/d/l/?s=kc.f&i=d
- `stooq_rc_f_daily` 200 text/html; charset=utf-8 — https://stooq.com/q/d/l/?s=rc.f&i=d
- `fred_imf_other_milds` 0 error:ReadTimeout:HTTPSConnectionPool(host='fred.stlouisfed. — https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCOFFOTMUSDM
- `fred_imf_robusta` 0 error:ReadTimeout:HTTPSConnectionPool(host='fred.stlouisfed. — https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCOFFROBUSDM
