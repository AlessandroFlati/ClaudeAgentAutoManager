def run(values):
    if not values:
        raise ValueError("values must be a non-empty list")
    return {"mean": sum(values) / len(values)}
