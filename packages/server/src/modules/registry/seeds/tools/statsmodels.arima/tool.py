def run(values, order_p, order_d, order_q):
    import numpy as np
    from statsmodels.tsa.arima.model import ARIMA
    model = ARIMA(values, order=(int(order_p), int(order_d), int(order_q)))
    result = model.fit()
    return {
        "aic": float(result.aic),
        "bic": float(result.bic),
        "params": np.array(result.params),
        "residuals": np.array(result.resid),
    }
