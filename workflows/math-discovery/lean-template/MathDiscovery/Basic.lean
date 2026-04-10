/-
MathDiscovery/Basic.lean — Core definitions for time series analysis.

Foundational types for formalizing conjectures about financial time series.
Import this file from any Conjectures/*.lean or Theorems/*.lean file.
-/

import Mathlib.Data.Real.Basic
import Mathlib.Analysis.SpecialFunctions.Log.Basic
import Mathlib.Topology.MetricSpace.Basic
import Mathlib.MeasureTheory.Integral.Lebesgue

namespace MathDiscovery

/-- A time series is a function from natural numbers (time indices) to reals. -/
def TimeSeries := ℕ → ℝ

/-- Log returns of a time series: log(p_{n+1} / p_n). -/
noncomputable def logReturns (p : TimeSeries) : TimeSeries :=
  fun n => Real.log (p (n + 1) / p n)

/-- Simple returns of a time series: (p_{n+1} - p_n) / p_n. -/
def simpleReturns (p : TimeSeries) : TimeSeries :=
  fun n => (p (n + 1) - p n) / p n

/-- A time series is strictly positive (required for log returns). -/
def IsPositive (p : TimeSeries) : Prop := ∀ n, p n > 0

/-- Rolling window sum over `window` bars starting at index `n`. -/
def rollingSum (s : TimeSeries) (window : ℕ) : TimeSeries :=
  fun n => (Finset.range window).sum (fun i => s (n + i))

/-- Rolling window mean. -/
noncomputable def rollingMean (s : TimeSeries) (window : ℕ) : TimeSeries :=
  fun n => rollingSum s window n / (window : ℝ)

/-- Absolute value of a series (for volatility proxies). -/
def absSeries (s : TimeSeries) : TimeSeries :=
  fun n => |s n|

/-- A series is bounded if there exists a uniform bound. -/
def IsBounded (s : TimeSeries) : Prop := ∃ M : ℝ, ∀ n, |s n| ≤ M

/-- A series is stationary in the weak sense (mean is constant). -/
def IsWeaklyStationary (s : TimeSeries) : Prop :=
  ∃ μ : ℝ, ∀ n m, rollingMean s n m = μ

/-- Autocorrelation at lag k (informal — requires expectation operator for formal version). -/
noncomputable def autocorrelation (s : TimeSeries) (lag k : ℕ) : ℝ :=
  -- Placeholder: formal definition requires measure theory setup
  0

end MathDiscovery
