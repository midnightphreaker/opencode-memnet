#!/usr/bin/env python3
"""Simple HTTP server to preview and select architecture diagrams."""

import os
import re
from http.server import HTTPServer, SimpleHTTPRequestHandler

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIAGRAMS_DIR = os.path.join(PROJECT_ROOT, "docs", "diagrams")

DIAGRAMS = sorted(
    [f for f in os.listdir(DIAGRAMS_DIR) if f.endswith(".svg") and f.startswith("diagram-")]
)

META = {
    "diagram-01-minimal.svg": {"title": "Clean Minimal", "style": "Soft colors, rounded boxes, subtle shadows — simple and clear"},
    "diagram-02-isometric.svg": {"title": "Isometric 3D", "style": "3D perspective boxes, gradient fills, cloud/cylinder shapes — modern SaaS look"},
    "diagram-03-dark.svg": {"title": "Dark Terminal", "style": "Dark background, neon glow effects, monospace font — terminal/hacker aesthetic"},
    "diagram-04-professional.svg": {"title": "Professional", "style": "Official docs quality, detailed services grid, protocol labels — Supabase/Firebase style"},
    "diagram-05-blueprint.svg": {"title": "Blueprint", "style": "Dark blue background, grid pattern, orthogonal routing — engineering schematic"},
    "diagram-06-gradient.svg": {"title": "Gradient Cards", "style": "Gradient headers, card layout, dot-pattern background, request flow — polished docs look"},
}

STYLE_COLORS = {
    "01": "#34D399",
    "02": "#0D9488",
    "03": "#22C55E",
    "04": "#059669",
    "05": "#67E8F9",
    "06": "#60A5FA",
}


def build_page():
    cards_html = []
    for filename in DIAGRAMS:
        num = re.search(r"diagram-(\d+)", filename).group(1)
        meta = META.get(filename, {"title": filename, "style": ""})
        color = STYLE_COLORS.get(num, "#60A5FA")
        svg_path = os.path.join(DIAGRAMS_DIR, filename)
        with open(svg_path, "r") as f:
            svg_content = f.read()

        card = (
            '<div class="card">'
            '  <div class="card-header">'
            f'    <div class="card-number" style="background:{color}">{num}</div>'
            '    <div>'
            f'      <div class="card-title">{meta["title"]}</div>'
            f'      <div class="card-style">{meta["style"]}</div>'
            '    </div>'
            '  </div>'
            '  <div class="card-preview">'
            f'    {svg_content}'
            '  </div>'
            '  <div class="card-footer">'
            f'    <span class="filename">{filename}</span>'
            f'    <a class="open-link" href="/docs/diagrams/{filename}" target="_blank">Open full SVG &rarr;</a>'
            '  </div>'
            '</div>'
        )
        cards_html.append(card)

    html = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>opencode-memnet — Architecture Diagram Selection</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0F172A; color: #E2E8F0; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; }
  .header { text-align: center; padding: 32px 20px 16px; }
  .header h1 { font-size: 24px; font-weight: 700; color: #F8FAFC; }
  .header p { font-size: 14px; color: #94A3B8; margin-top: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 24px; padding: 16px 32px 48px; max-width: 1600px; margin: 0 auto; }
  .card { background: #1E293B; border-radius: 12px; overflow: hidden; border: 1px solid #334155; transition: border-color 0.2s; }
  .card:hover { border-color: #475569; }
  .card-header { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid #334155; }
  .card-number { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; color: white; }
  .card-title { font-size: 16px; font-weight: 600; color: #F1F5F9; }
  .card-style { font-size: 12px; color: #94A3B8; margin-top: 2px; }
  .card-preview { background: white; padding: 0; display: flex; align-items: center; justify-content: center; min-height: 320px; }
  .card-preview svg { width: 100%; height: auto; max-height: 500px; }
  .card-footer { padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #334155; }
  .filename { font-family: 'SF Mono', 'Fira Code', Consolas, monospace; font-size: 12px; color: #64748B; }
  .open-link { color: #60A5FA; text-decoration: none; font-size: 13px; font-weight: 500; }
  .open-link:hover { text-decoration: underline; }
  .footer { text-align: center; padding: 16px; font-size: 12px; color: #475569; }
</style>
</head>
<body>
<div class="header">
  <h1>opencode-memnet &mdash; Architecture Diagrams</h1>
  <p>""" + str(len(DIAGRAMS)) + """ styles to choose from. Click a filename to view the full SVG.</p>
</div>
<div class="grid">
""" + "\n".join(cards_html) + """
</div>
<div class="footer">
  Diagrams stored in <code>docs/diagrams/</code> &middot; Open the one you like and note the filename
</div>
</body>
</html>"""
    return html


class DiagramHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "":
            content = build_page().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        else:
            super().do_GET()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    HOST = "10.9.9.20"
    PORT = 13370

    os.chdir(PROJECT_ROOT)

    print(f"\n  Architecture Diagram Viewer")
    print(f"  -------------------------")
    print(f"  Listening on http://{HOST}:{PORT}")
    print(f"  Diagrams: {len(DIAGRAMS)}")
    for d in DIAGRAMS:
        m = META.get(d, {"title": d})
        print(f"    [{d}] {m['title']}")
    print(f"  -------------------------")
    print(f"  Open in browser to view and select\n")

    server = HTTPServer((HOST, PORT), DiagramHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
