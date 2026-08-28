"""
Standalone runner for the MapBiomas coffee crop-area exporter.
Used by workflow 1.13. Writes frontend/public/data/coffee_crop_area.json.

    cd backend && python -m scraper.run_mapbiomas_coffee
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scraper.sources.mapbiomas_coffee import run

if __name__ == "__main__":
    # Non-zero exit if nothing was written, so the workflow surfaces it rather
    # than committing silence. The previous file is retained either way.
    sys.exit(0 if run() else 1)
