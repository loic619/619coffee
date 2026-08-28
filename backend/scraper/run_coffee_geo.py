"""
Standalone runner for the coffee-municipality geometry exporter.
Runs after the area export in workflow 1.24 — it reads the geocodes that
export produced. Writes frontend/public/data/coffee_crop_geo.json.

    cd backend && python -m scraper.run_coffee_geo
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.sources.coffee_crop_geo import run

if __name__ == "__main__":
    sys.exit(0 if run() else 1)
