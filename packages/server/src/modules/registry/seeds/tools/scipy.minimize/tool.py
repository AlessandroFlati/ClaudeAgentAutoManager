# Named-function registry for scipy.minimize.
# Extend FUNCTIONS to add more named functions; do not use eval/exec.

FUNCTIONS = {
    'rosenbrock': lambda x: (1 - x[0])**2 + 100 * (x[1] - x[0]**2)**2,
    'quadratic':  lambda x: x[0]**2 + x[1]**2,
    'sphere':     lambda x: sum(xi**2 for xi in x),
}


def run(x0, method, func_name):
    from scipy.optimize import minimize
    import numpy as np
    if func_name not in FUNCTIONS:
        raise ValueError(f"Unknown func_name '{func_name}'. Available: {list(FUNCTIONS)}")
    result = minimize(FUNCTIONS[func_name], np.array(x0), method=method)
    return {
        "x": result.x,
        "fun": float(result.fun),
        "success": bool(result.success),
        "message": str(result.message),
    }
