def run(values):
    import numpy as np
    from statsmodels.tsa.stattools import adfuller
    arr = np.array(values, dtype=float)
    result = adfuller(arr)
    statistic, p_value, used_lag, _, critical_values, _ = result
    return {
        "statistic": float(statistic),
        "p_value": float(p_value),
        "used_lag": int(used_lag),
        "critical_values": {k: float(v) for k, v in critical_values.items()},
    }
