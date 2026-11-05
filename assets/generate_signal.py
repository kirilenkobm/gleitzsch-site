"""Run with Python 3 to regenerate the neighbouring signal.svg illustration."""

import math
from pathlib import Path


def render_signal():
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 820">',
        '<rect width="680" height="820" fill="#101612"/>',
        '<g fill="none" stroke-width="1.1">',
    ]
    for colour, shift in [("#6aaaff", -9), ("#e68cbd", 9), ("#dcff79", 0)]:
        for row in range(105):
            y = 65 + row * 6.4
            dy = (y - 410) / 350
            envelope = math.exp(-((dy + 0.08) ** 2) * 2.6)
            opacity = 0.23 + 0.55 * math.exp(-(((y - 410) / 220) ** 2))
            points = []
            for x in range(40, 641, 4):
                dx = (x - 340) / 300
                bend = (
                    65 * math.sin(dx * 4.5 + dy * 5) * envelope
                    + 32 * math.sin(dx * 9 - dy * 3) * envelope
                )
                shifted_x = (
                    x + shift * math.sin(dy * 4)
                    + 15 * math.sin(dy * 18) * math.exp(-((dy - 0.5) * 9) ** 2)
                )
                points.append(f"{shifted_x:.1f},{y + bend:.1f}")
            parts.append(
                f'<polyline points="{" ".join(points)}" '
                f'stroke="{colour}" stroke-opacity="{opacity:.2f}"/>'
            )
    parts.extend([
        '</g><g fill="#d6ff56" font-family="monospace" font-size="10" letter-spacing="2">',
        '<text x="35" y="35">GLEITZSCH</text>',
        '<text x="35" y="790">SIGNAL STUDY — 001</text>',
        '<text x="570" y="790">↗ 30 Hz</text></g></svg>',
    ])
    return "".join(parts)


if __name__ == "__main__":
    Path(__file__).with_name("signal.svg").write_text(render_signal(), encoding="utf-8")
