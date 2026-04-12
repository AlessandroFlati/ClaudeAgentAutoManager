def run(c, A_ub, b_ub):
    from scipy.optimize import linprog
    import numpy as np
    c_arr = np.array(c)
    A_ub_arr = np.array(A_ub)
    b_ub_arr = np.array(b_ub)
    result = linprog(c_arr, A_ub=A_ub_arr, b_ub=b_ub_arr, method='highs')
    return {
        "x": result.x,
        "fun": float(result.fun),
        "success": bool(result.success),
    }
