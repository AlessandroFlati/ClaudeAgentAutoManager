import numpy as np
from sklearn.linear_model import LinearRegression


def test_predict_with_linear_model():
    x_train = np.array([[1.0], [2.0], [3.0], [4.0]])
    y_train = np.array([2.0, 4.0, 6.0, 8.0])
    model = LinearRegression()
    model.fit(x_train, y_train)
    x_test = np.array([[5.0], [6.0]])
    result = invoke_tool(model=model, x=x_test)
    preds = result["predictions"]
    assert preds.shape == (2,)
    assert abs(preds[0] - 10.0) < 0.1
    assert abs(preds[1] - 12.0) < 0.1


def test_predict_multivariate():
    rng = np.random.default_rng(0)
    X_train = rng.standard_normal((50, 3))
    coef = np.array([1.0, -1.0, 2.0])
    y_train = X_train @ coef
    model = LinearRegression()
    model.fit(X_train, y_train)
    X_test = rng.standard_normal((10, 3))
    result = invoke_tool(model=model, x=X_test)
    assert result["predictions"].shape == (10,)


if __name__ == "__main__":
    test_predict_with_linear_model()
    test_predict_multivariate()
    print("All tests passed.")
