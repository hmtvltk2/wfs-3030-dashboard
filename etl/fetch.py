"""Tải dữ liệu thô (GeoJSON, EPSG:3857) của các lớp trong dịch vụ WFS NextGIS resource 62.

WFS chỉ trả GML và tối đa 1000 đối tượng/lần, nên dùng REST export /api/resource/{id}/geojson
của chính NextGIS — trả toàn bộ lớp trong một lần.

Chạy:  .venv/Scripts/python etl/fetch.py
"""
import json
import pathlib
import sys
import urllib.request

BASE = "https://nextgis.hcmgis.vn/api/resource"
SERVICE_ID = 62
RAW_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw"


def get(url, timeout=300):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    service = json.loads(get(f"{BASE}/{SERVICE_ID}"))
    layers = service["wfsserver_service"]["layers"]
    manifest = []
    for layer in layers:
        rid = layer["resource_id"]
        out = RAW_DIR / f"{rid}.geojson"
        print(f"[{rid}] {layer['display_name']} ...", end=" ", flush=True)
        data = get(f"{BASE}/{rid}/geojson")
        out.write_bytes(data)
        n = len(json.loads(data)["features"])
        print(f"{n} đối tượng, {len(data) / 1e6:.1f} MB")
        manifest.append({"id": rid, "keyname": layer["keyname"], "name": layer["display_name"], "count": n})
    (RAW_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
