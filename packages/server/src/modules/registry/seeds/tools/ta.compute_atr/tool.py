def run(high, low, close, period):
    import numpy as np
    import pandas as pd
    high_s = pd.Series(np.array(high, dtype=float))
    low_s = pd.Series(np.array(low, dtype=float))
    close_s = pd.Series(np.array(close, dtype=float))
    prev_close = close_s.shift(1)
    tr = pd.concat([
        high_s - low_s,
        (high_s - prev_close).abs(),
        (low_s - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr = tr.ewm(com=int(period) - 1, min_periods=int(period)).mean()
    return {"atr": atr.to_numpy()}
