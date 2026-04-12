def run(data, confidence, n_resamples):
    import numpy as np
    from scipy import stats
    data_arr = np.array(data, dtype=float)
    if not (0 < confidence < 1):
        raise ValueError("confidence must be between 0 and 1 (exclusive)")
    if n_resamples < 1:
        raise ValueError("n_resamples must be >= 1")
    result = stats.bootstrap(
        (data_arr,),
        np.mean,
        n_resamples=n_resamples,
        confidence_level=confidence,
        random_state=0,
    )
    return {"ci_low": float(result.confidence_interval.low), "ci_high": float(result.confidence_interval.high)}
