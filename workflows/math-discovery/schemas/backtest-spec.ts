/**
 * Backtest Spec — trading rules derived from confirmed mathematical findings.
 * Used only in Phase C (Operational Validation).
 */

export interface EntryCondition {
  description: string;             // Human-readable rule
  expression: string;              // Python expression or DSL
  variables: string[];             // Inputs the rule depends on
}

export interface ExitCondition {
  type: 'time' | 'target' | 'stop' | 'condition';
  description: string;
  expression?: string;
  value?: number;                  // For time (bars), target/stop (%)
}

export interface SizingRule {
  method: 'fixed' | 'percent_equity' | 'volatility_scaled' | 'kelly';
  base_size: number;
  max_position?: number;
  volatility_target?: number;      // Annualized vol target for vol-scaled
}

export interface BacktestSpec {
  schema_version: 1;

  // Provenance: which findings justify this strategy
  derived_from: Array<{
    finding_id: string;              // Conjecture ID
    theorem_name: string;            // Lean theorem name
    justification: string;           // How the finding maps to the rule
  }>;

  // Trading rule
  name: string;
  description: string;
  hypothesis_to_test: string;      // The claim being validated (not the theorem)

  // Universe
  universe: {
    symbols: string[];
    timeframes: string[];
    start: string;                   // ISO-8601
    end: string;
  };

  // Rules
  entry: {
    long: EntryCondition | null;
    short: EntryCondition | null;
  };
  exit: ExitCondition[];
  sizing: SizingRule;

  // Execution assumptions
  execution: {
    commission_bps: number;          // Commission in basis points
    slippage_bps: number;
    max_holding_bars: number;
  };

  // Significance tests to run
  significance_tests: Array<{
    test: 'bootstrap_sharpe' | 'reality_check' | 'deflated_sharpe' | 'white_reality';
    n_iterations?: number;
    confidence_level: number;
  }>;
}

export interface BacktestResult {
  spec_ref: string;                // Path to backtest-spec.json
  run_at: string;

  // Performance metrics
  metrics: {
    total_return: number;
    annualized_return: number;
    annualized_volatility: number;
    sharpe_ratio: number;
    sortino_ratio: number;
    max_drawdown: number;
    calmar_ratio: number;
    win_rate: number;
    profit_factor: number;
    n_trades: number;
    avg_holding_bars: number;
  };

  // Statistical significance
  significance: Array<{
    test: string;
    p_value: number;
    confidence_interval: [number, number];
    verdict: 'significant' | 'not_significant';
  }>;

  // Per-symbol breakdown
  per_symbol: Array<{
    symbol: string;
    n_trades: number;
    total_pnl: number;
    sharpe: number;
  }>;

  // Verdict
  verdict: 'tradeable' | 'marginal' | 'not_tradeable';
  notes: string;
}
