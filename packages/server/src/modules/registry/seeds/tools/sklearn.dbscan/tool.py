def run(X, eps, min_samples):
    from sklearn.cluster import DBSCAN
    import numpy as np
    X_arr = np.array(X)
    if eps <= 0:
        raise ValueError("eps must be > 0")
    if min_samples < 1:
        raise ValueError("min_samples must be >= 1")
    dbscan = DBSCAN(eps=eps, min_samples=min_samples)
    labels = dbscan.fit_predict(X_arr)
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    return {
        "labels": labels,
        "n_clusters": int(n_clusters),
    }
