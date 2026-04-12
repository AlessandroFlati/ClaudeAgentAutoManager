# Named-function registry for scipy.curve_fit.
# Extend FUNCTIONS to add more model functions; do not use eval/exec.

def _exponential(x, a, b):
    import numpy as np
    return a * np.exp(b * x)


FUNCTIONS = {
    'linear':      lambda x, a, b: a * x + b,
    'quadratic':   lambda x, a, b, c: a * x**2 + b * x + c,
    'exponential': _exponential,
}


def run(xdata, ydata, p0, func_name):
    from scipy.optimize import curve_fit
    import numpy as np
    if func_name not in FUNCTIONS:
        raise ValueError(f"Unknown func_name '{func_name}'. Available: {list(FUNCTIONS)}")
    xdata_arr = np.array(xdata)
    ydata_arr = np.array(ydata)
    p0_arr = np.array(p0)
    popt, pcov = curve_fit(FUNCTIONS[func_name], xdata_arr, ydata_arr, p0=p0_arr)
    return {
        "popt": popt,
        "pcov": pcov,
    }
