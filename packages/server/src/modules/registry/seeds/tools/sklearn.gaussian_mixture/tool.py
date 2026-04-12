def run(X, n_components):
    from sklearn.mixture import GaussianMixture
    import numpy as np
    X_arr = np.array(X)
    if n_components < 1:
        raise ValueError("n_components must be >= 1")
    gmm = GaussianMixture(n_components=n_components, random_state=42)
    labels = gmm.fit_predict(X_arr)
    return {
        "labels": labels,
        "means": gmm.means_,
        "bic": float(gmm.bic(X_arr)),
    }
