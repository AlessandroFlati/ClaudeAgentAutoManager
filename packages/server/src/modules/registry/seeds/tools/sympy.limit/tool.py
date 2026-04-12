def run(expr, variable, point):
    import sympy
    var = sympy.Symbol(variable)
    point_expr = sympy.sympify(point)
    return {"result": sympy.limit(expr, var, point_expr)}
