def run(returns, p, q):
    import numpy as np
    from arch import arch_model
    model = arch_model(returns, vol='Garch', p=int(p), q=int(q))
    result = model.fit(disp='off')
    return {
        "params": np.array(result.params),
        "conditional_volatility": np.array(result.conditional_volatility),
        "aic": float(result.aic),
    }
