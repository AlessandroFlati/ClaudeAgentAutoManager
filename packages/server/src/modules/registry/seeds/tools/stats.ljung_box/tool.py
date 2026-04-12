def run(residuals, lags):
    import numpy as np
    from statsmodels.stats.diagnostic import acorr_ljungbox
    arr = np.array(residuals, dtype=float)
    if lags < 1:
        raise ValueError("lags must be >= 1")
    result = acorr_ljungbox(arr, lags=[lags], return_df=True)
    statistic = float(result['lb_stat'].iloc[0])
    p_value = float(result['lb_pvalue'].iloc[0])
    return {"statistic": statistic, "p_value": p_value}
