def run(values, period, model):
    import numpy as np
    from statsmodels.tsa.seasonal import seasonal_decompose
    result = seasonal_decompose(values, model=str(model), period=int(period), extrapolate_trend='freq')
    return {
        "trend": np.array(result.trend),
        "seasonal": np.array(result.seasonal),
        "residual": np.array(result.resid),
    }
