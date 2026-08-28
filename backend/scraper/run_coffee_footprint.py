"""
Standalone runner for the coffee-footprint exporter (workflow 1.25).
Streams the MapBiomas raster and writes frontend/public/data/coffee_footprint.json.

    cd backend && python -m scraper.run_coffee_footprint
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.sources.coffee_footprint import run

if __name__ == "__main__":
    sys.exit(0 if run() else 1)
