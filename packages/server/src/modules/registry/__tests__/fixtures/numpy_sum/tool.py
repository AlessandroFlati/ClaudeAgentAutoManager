def run(values):
    import numpy as np
    arr = np.array(values, dtype=float)
    return {"array": arr, "sum": float(arr.sum())}
