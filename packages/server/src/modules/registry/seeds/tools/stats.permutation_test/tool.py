def run(a, b, n_resamples):
    import numpy as np
    from scipy import stats
    a_arr = np.array(a, dtype=float)
    b_arr = np.array(b, dtype=float)
    if n_resamples < 1:
        raise ValueError("n_resamples must be >= 1")

    def statistic(x, y):
        return np.mean(x) - np.mean(y)

    result = stats.permutation_test(
        (a_arr, b_arr),
        statistic,
        n_resamples=n_resamples,
        alternative='two-sided',
        random_state=0,
    )
    return {"statistic": float(result.statistic), "p_value": float(result.pvalue)}
