def run(data, path):
    import json
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return {"written": True}
