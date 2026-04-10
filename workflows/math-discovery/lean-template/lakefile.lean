import Lake
open Lake DSL

package "math-discovery" where
  version := v!"0.1.0"

lean_lib "MathDiscovery" where

require mathlib from git
  "https://github.com/leanprover-community/mathlib4.git" @ "v4.29.0"

@[default_target]
lean_lib "MathDiscovery"
