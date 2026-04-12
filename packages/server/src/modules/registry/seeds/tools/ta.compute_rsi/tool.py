def run(close, period):
    import numpy as np
    import pandas as pd
    close_s = pd.Series(np.array(close, dtype=float))
    delta = close_s.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=int(period) - 1, min_periods=int(period)).mean()
    avg_loss = loss.ewm(com=int(period) - 1, min_periods=int(period)).mean()
    rs = avg_gain / avg_loss
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return {"rsi": rsi.to_numpy()}
