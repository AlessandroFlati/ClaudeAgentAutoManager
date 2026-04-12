def run(X, n_clusters, linkage):
    from sklearn.cluster import AgglomerativeClustering
    import numpy as np
    X_arr = np.array(X)
    if n_clusters < 1:
        raise ValueError("n_clusters must be >= 1")
    valid_linkages = ['ward', 'complete', 'average', 'single']
    if linkage not in valid_linkages:
        raise ValueError(f"linkage must be one of {valid_linkages}")
    clustering = AgglomerativeClustering(n_clusters=n_clusters, linkage=linkage)
    labels = clustering.fit_predict(X_arr)
    return {
        "labels": labels,
    }
