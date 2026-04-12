import numpy as np
import pandas as pd
from tool import run


def test_2d_array():
    arr = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])
    result = run(arr)
    df = result["target"]
    assert isinstance(df, pd.DataFrame)
    assert df.shape == (3, 2)
    assert df.iloc[0, 0] == 1.0
    assert df.iloc[2, 1] == 6.0


def test_1d_array_single_column():
    arr = np.array([10, 20, 30])
    result = run(arr)
    df = result["target"]
    assert isinstance(df, pd.DataFrame)
    assert df.shape == (3, 1)
    assert df.iloc[0, 0] == 10


if __name__ == "__main__":
    test_2d_array()
    test_1d_array_single_column()
    print("All tests passed.")
