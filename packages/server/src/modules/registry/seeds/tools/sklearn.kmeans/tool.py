def run(X, n_clusters):
    from sklearn.cluster import KMeans
    import numpy as np
    X_arr = np.array(X)
    if n_clusters < 1:
        raise ValueError("n_clusters must be >= 1")
    kmeans = KMeans(n_clusters=n_clusters, random_state=42)
    labels = kmeans.fit_predict(X_arr)
    return {
        "labels": labels,
        "centroids": kmeans.cluster_centers_,
        "inertia": kmeans.inertia_,
    }
