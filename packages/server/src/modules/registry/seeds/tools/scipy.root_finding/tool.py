# Named-function registry for scipy.root_finding.
# Extend FUNCTIONS to add more named functions; do not use eval/exec.

FUNCTIONS = {
    'quadratic_shift': lambda x: [x[0]**2 - 2],
    'cubic':           lambda x: [x[0]**3 - x[0] - 2],
    'linear_system':   lambda x: [2 * x[0] + x[1] - 1, x[0] - x[1]],
}


def run(x0, method, func_name):
    from scipy.optimize import root
    import numpy as np
    if func_name not in FUNCTIONS:
        raise ValueError(f"Unknown func_name '{func_name}'. Available: {list(FUNCTIONS)}")
    result = root(FUNCTIONS[func_name], np.array(x0), method=method)
    return {
        "x": result.x,
        "success": bool(result.success),
    }
