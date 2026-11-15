from app.ai.ratelimit import SlidingWindowLimiter


def test_window_slides():
    t = [0.0]
    lim = SlidingWindowLimiter(2, 10, clock=lambda: t[0])
    assert lim.hit("u") is None
    assert lim.hit("u") is None
    assert lim.hit("u") is not None
    t[0] = 10.5
    assert lim.hit("u") is None
    assert lim.hit("other") is None
