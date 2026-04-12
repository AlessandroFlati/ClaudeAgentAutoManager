import numpy as np
import pandas as pd


def run(source: np.ndarray) -> dict:
    df = pd.DataFrame(source)
    return {"target": df}
