import numpy as np
import pandas as pd


def run(source: pd.DataFrame) -> dict:
    arr = source.values
    return {"target": arr}
