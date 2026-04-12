def run(a, b):
    import numpy as np
    from scipy import stats
    a_arr = np.array(a, dtype=float)
    b_arr = np.array(b, dtype=float)
    result = stats.ttest_ind(a_arr, b_arr)
    return {"statistic": float(result.statistic), "p_value": float(result.pvalue)}
