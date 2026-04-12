def run(values, period):
    import numpy as np
    from statsmodels.tsa.seasonal import seasonal_decompose
    result = seasonal_decompose(values, model='additive', period=int(period), extrapolate_trend='freq')
    adjusted = np.array(values) - np.array(result.seasonal)
    return {
        "adjusted": adjusted,
    }
