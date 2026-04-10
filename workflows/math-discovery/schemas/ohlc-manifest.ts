/**
 * OHLC Manifest — descriptor for financial data sources.
 * Produced by the OHLC Fetcher, consumed by the Profiler and downstream agents.
 */

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1';

export interface OhlcSymbol {
  symbol: string;              // e.g. "EURUSD", "XAUUSD", "SPX500"
  asset_class: 'forex' | 'metal' | 'index' | 'commodity' | 'crypto' | 'bond';
  quote_currency: string;      // e.g. "USD"
  tick_size: number;
  contract_size?: number;
}

export interface OhlcSeries {
  symbol: string;
  timeframe: Timeframe;
  start: string;               // ISO-8601
  end: string;                 // ISO-8601
  n_bars: number;
  file: string;                // Relative path to parquet file
  columns: string[];           // Usually ['timestamp', 'open', 'high', 'low', 'close', 'volume']
  gaps_detected: number;       // Number of missing bars
  quality_score: number;       // [0,1] — data quality assessment
}

export interface OhlcManifest {
  schema_version: 1;
  generated_at: string;
  symbols: OhlcSymbol[];
  series: OhlcSeries[];
  total_bars: number;
  coverage_months: number;
}

export interface DataProfile {
  schema_version: 1;
  generated_at: string;
  manifest_ref: string;            // Path to ohlc-manifest.json

  // Per-series statistical profile
  series_profiles: Array<{
    symbol: string;
    timeframe: Timeframe;

    // Return distribution
    returns: {
      n: number;
      mean: number;
      std: number;
      skewness: number;
      kurtosis: number;              // Excess kurtosis (normal = 0)
      jarque_bera_p: number;         // p-value of normality test
      has_fat_tails: boolean;
      tail_index?: number;           // Hill estimator for extreme tails
    };

    // Stationarity
    stationarity: {
      adf_p: number;                  // Augmented Dickey-Fuller
      kpss_p: number;                 // KPSS test
      is_stationary: boolean;         // Combined verdict
    };

    // Autocorrelation
    autocorrelation: {
      lag1: number;
      lag5: number;
      lag10: number;
      ljung_box_p: number;           // Test for serial correlation
    };

    // Volatility
    volatility: {
      realized: number;
      garch_alpha?: number;          // GARCH(1,1) fit
      garch_beta?: number;
      persistence?: number;           // alpha + beta (close to 1 = persistent)
    };
  }>;

  // Cross-series relationships
  correlations: Array<{
    series_a: string;                 // "EURUSD.M5"
    series_b: string;
    pearson: number;
    spearman: number;
    rolling_window?: number;          // If computed on rolling window
  }>;

  // Regime detection
  regimes: Array<{
    series: string;
    changepoints: string[];           // ISO-8601 timestamps
    method: 'hmm' | 'bocpd' | 'binseg';
    n_regimes: number;
  }>;

  // Analysis leads (ranked)
  analysis_leads: Array<{
    id: string;
    priority: 'low' | 'medium' | 'high';
    description: string;
    evidence: string;
    suggested_domain: string;         // From ConjectureDomain
  }>;
}
