def run(observed):
    import numpy as np
    from scipy import stats
    obs_arr = np.array(observed, dtype=float)
    result = stats.chisquare(obs_arr)
    dof = len(obs_arr) - 1
    return {"statistic": float(result.statistic), "p_value": float(result.pvalue), "dof": int(dof)}
