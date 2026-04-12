import numpy as np
import pandas as pd
from tool import run


def test_basic():
    df = pd.DataFrame({"a": [1.0, 2.0], "b": [3.0, 4.0]})
    result = run(df)
    arr = result["target"]
    assert isinstance(arr, np.ndarray)
    assert arr.shape == (2, 2)
    assert arr[0, 0] == 1.0


def test_single_column():
    df = pd.DataFrame({"x": [10, 20, 30]})
    result = run(df)
    arr = result["target"]
    assert arr.shape == (3, 1)


if __name__ == "__main__":
    test_basic()
    test_single_column()
    print("All tests passed.")
