"""Làm sạch dữ liệu thô, tính chỉ số và phân tích chéo, xuất ra public/data/ cho dashboard.

Đầu vào : data/raw/{resource_id}.geojson (từ etl/fetch.py, EPSG:3857)
Đầu ra  : public/data/summary.json   — KPI, số liệu biểu đồ, cảnh báo, chất lượng dữ liệu
          public/data/geo/*.geojson   — lớp bản đồ đã giản lược, EPSG:4326

Chạy:  .venv/Scripts/python etl/build.py
"""
import collections
import datetime as dt
import json
import math
import pathlib
import re
import sys

import numpy as np
import shapely
from shapely.geometry import mapping, shape
from shapely.strtree import STRtree

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"
GEO = OUT / "geo"

R_EARTH = 6378137.0

# Mã phường (danh mục hành chính) → tên phường cũ của Quận Thủ Đức.
# Đối chiếu bằng vị trí: mỗi mã khớp với phường của thửa lân cận gần nhất (xem README).
WARD_CODES = {
    "26794": "Linh Xuân", "26797": "Bình Chiểu", "26800": "Linh Trung", "26803": "Tam Bình",
    "26806": "Tam Phú", "26809": "Hiệp Bình Phước", "26812": "Hiệp Bình Chánh", "26815": "Linh Chiểu",
    "26818": "Linh Tây", "26821": "Linh Đông", "26824": "Bình Thọ", "26827": "Trường Thọ",
}

# Mã loại đất (Thông tư hướng dẫn thống kê, kiểm kê đất đai) → tên & nhóm so sánh.
LAND_CODES = {
    "ODT": ("Đất ở tại đô thị", "Nhà ở"),
    "DGT": ("Đất giao thông", "Giao thông"),
    "SKC": ("Đất cơ sở sản xuất phi nông nghiệp", "Công nghiệp – sản xuất"),
    "SKK": ("Đất khu công nghiệp", "Công nghiệp – sản xuất"),
    "DGD": ("Đất giáo dục – đào tạo", "Giáo dục"),
    "TON": ("Đất tôn giáo", "Tôn giáo – tín ngưỡng"),
    "TIN": ("Đất tín ngưỡng", "Tôn giáo – tín ngưỡng"),
    "TTN": ("Đất tôn giáo, tín ngưỡng", "Tôn giáo – tín ngưỡng"),
    "CLN": ("Đất trồng cây lâu năm", "Nông nghiệp"),
    "LUC": ("Đất chuyên trồng lúa", "Nông nghiệp"),
    "LUA": ("Đất trồng lúa", "Nông nghiệp"),
    "NTS": ("Đất nuôi trồng thủy sản", "Nông nghiệp"),
    "SON": ("Đất sông, ngòi, kênh, rạch", "Mặt nước – thủy lợi"),
    "DTL": ("Đất thủy lợi", "Mặt nước – thủy lợi"),
    "CTS": ("Đất trụ sở cơ quan", "Công cộng – cơ quan"),
    "TSC": ("Đất trụ sở cơ quan", "Công cộng – cơ quan"),
    "CCC": ("Đất có mục đích công cộng", "Công cộng – cơ quan"),
    "DYT": ("Đất y tế", "Công cộng – cơ quan"),
    "DXH": ("Đất xã hội", "Công cộng – cơ quan"),
    "DVH": ("Đất văn hóa", "Công cộng – cơ quan"),
    "DCH": ("Đất chợ", "Công cộng – cơ quan"),
    "CAN": ("Đất an ninh", "Công cộng – cơ quan"),
    "CQP": ("Đất quốc phòng", "Công cộng – cơ quan"),
    "NTD": ("Đất nghĩa trang, nghĩa địa", "Nghĩa trang"),
    "DNL": ("Đất công trình năng lượng", "Hạ tầng kỹ thuật"),
    "DRA": ("Đất bãi thải, xử lý chất thải", "Hạ tầng kỹ thuật"),
    "PNK": ("Đất phi nông nghiệp khác", "Khác"),
}

# Nhóm chức năng cho lớp sử dụng đất quy hoạch chung/phân khu (tên chức năng là văn bản tự do).
QH_GROUPS = [
    ("Hỗn hợp", ["hỗn hợp"]),
    ("Giáo dục", ["giáo dục", "học tập", "nhà trẻ", "mẫu giáo", "nghiên cứu", "ký túc xá", "trường", "mầm non", "tiểu học", "thcs", "thpt", "đào tạo", "dạy nghề", "đại học"]),
    ("Công cộng – cơ quan", ["y tế", "bệnh viện", "công trình công cộng", "dịch vụ công cộng", "hành chính", "văn hóa",
                            "cơ quan", "an ninh", "quốc phòng", "quân sự", "trụ sở", "chợ", "công cộng"]),
    ("Nhà ở", ["nhà ở", "đất ở", " ở ", "tái định cư", "dân cư", "chung cư", "biệt thự", "liên kế", "khu ở"]),
    ("Cây xanh – TDTT", ["cây xanh", "công viên", "tdtt", "thể dục", "thể thao", "vườn", "cách ly", "mảng xanh", "vui chơi", "giải trí"]),
    ("Thương mại – dịch vụ", ["thương mại", "dịch vụ", "tmdv", "văn phòng", "khách sạn"]),
    ("Tôn giáo – tín ngưỡng", ["tôn giáo", "tín ngưỡng", "chùa", "nhà thờ", "đình"]),
    ("Công nghiệp – sản xuất", ["công nghiệp", "kho", "sản xuất", "chế xuất", "tiểu thủ"]),
    ("Giao thông", ["giao thông", "bãi đỗ", "bãi xe", "bãi đậu", "bến", "đường", "nút giao", "ga "]),
    ("Mặt nước – thủy lợi", ["mặt nước", "sông", "kênh", "rạch", "hồ ", "thủy lợi"]),
    ("Hạ tầng kỹ thuật", ["hạ tầng", "công trình kỹ thuật", "đầu mối", "trạm", "xử lý", "cấp nước", "điện", "nghĩa trang"]),
]

HOSO_TYPES = {
    "GPXD": "Giấy phép xây dựng", "TĐDA": "Thẩm định dự án", "TĐTK": "Thẩm định thiết kế",
    "PTN": "Phê duyệt (PTN)", "TKCS": "Thiết kế cơ sở", "TKKT": "Thiết kế kỹ thuật",
}

SUSPECT_CAPITAL = 50_000e9  # vốn > 50.000 tỷ đồng cho một công trình được coi là nhập sai
ROAD_SITE_RATIO = 0.20     # công trình lấn ranh lộ giới: ≥ 20% diện tích nền nằm trong ranh đường
ROAD_PARCEL_RATIO = 0.30   # thửa đất ảnh hưởng lộ giới: ≥ 30% diện tích thửa
OPEN_GROUPS = ("Cây xanh – TDTT", "Giao thông", "Mặt nước – thủy lợi")


# ---------------------------------------------------------------- tiện ích hình học

def load(rid):
    feats = json.loads((RAW / f"{rid}.geojson").read_text(encoding="utf-8"))["features"]
    out = []
    for f in feats:
        g = shape(f["geometry"]) if f.get("geometry") else None
        if g is not None and not g.is_valid:
            g = shapely.make_valid(g)
        out.append((f["properties"], g))
    return out


def scale_at(y):
    """Hệ số chiều dài thật / chiều dài Web Mercator tại tung độ y (EPSG:3857)."""
    lat = 2 * math.atan(math.exp(y / R_EARTH)) - math.pi / 2
    return math.cos(lat)


def true_area(g):
    if g is None or g.is_empty:
        return 0.0
    return g.area * scale_at(g.centroid.y) ** 2


def true_length(g):
    if g is None or g.is_empty:
        return 0.0
    return g.length * scale_at(g.centroid.y)


def to_wgs84(coords):
    x, y = coords[:, 0], coords[:, 1]
    lon = np.degrees(x / R_EARTH)
    lat = np.degrees(2 * np.arctan(np.exp(y / R_EARTH)) - np.pi / 2)
    return np.round(np.column_stack([lon, lat]), 6)


def write_geo(name, rows, props_fn, tolerance=1.0, as_point=False):
    """rows: [(props, geom3857)] → GeoJSON 4326 đã giản lược, chỉ giữ thuộc tính cần hiển thị.
    as_point: xuất điểm đại diện thay cho đa giác (công trình nhỏ, xem ở mức toàn quận)."""
    feats = []
    for p, g in rows:
        if g is None or g.is_empty:
            continue
        if as_point:
            gs = g.representative_point()
        else:
            gs = shapely.simplify(g, tolerance, preserve_topology=True) if tolerance else g
        gs = shapely.transform(gs, to_wgs84)
        feats.append({"type": "Feature", "properties": props_fn(p, g), "geometry": mapping(gs)})
    GEO.mkdir(parents=True, exist_ok=True)
    path = GEO / f"{name}.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False,
                               separators=(",", ":")), encoding="utf-8")
    return len(feats), path.stat().st_size


def bbox4326(geoms):
    b = shapely.total_bounds(np.array([g for g in geoms if g is not None]))
    sw = to_wgs84(np.array([[b[0], b[1]]]))[0]
    ne = to_wgs84(np.array([[b[2], b[3]]]))[0]
    return [[float(sw[1]), float(sw[0])], [float(ne[1]), float(ne[0])]]


# ---------------------------------------------------------------- tiện ích thuộc tính

def clean(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = re.sub(r"\s+", " ", v).strip()
        return v or None
    return v


def counter_list(c, order=None, label=None):
    keys = order if order else [k for k, _ in c.most_common()]
    return [{"label": label(k) if label else k, "value": c.get(k, 0)} for k in keys]


def group_qh(name):
    s = f" {(name or '').lower()} "
    for grp, kws in QH_GROUPS:
        if any(k in s for k in kws):
            return grp
    return "Khác"


def ho_so_info(code):
    """'GPXD-2013-45' → ('GPXD', 2013); mã thuần số → (None, None)."""
    code = clean(code) or ""
    m = re.match(r"^([A-ZĐ]+)(?:-[A-Z]+)?-(\d{4})-\d+$", code)
    if not m:
        return None, None
    return m.group(1), int(m.group(2))


def r1(x):
    return round(x, 1)


# ---------------------------------------------------------------- gán phường theo vị trí

class WardLocator:
    """Gán phường bằng thửa có thuộc tính phường gần nhất (lớp Cấp phép số nhà + Thửa đất).

    Dữ liệu không có lớp ranh giới hành chính, nên đây là ước lượng theo lân cận gần nhất;
    đã kiểm chứng với mã phường trong lớp GPXD (xem README)."""

    def __init__(self, labelled):
        self.pts, self.names = [], []
        for name, g in labelled:
            # chỉ dùng tên 12 phường cũ làm nhãn (vài thửa ghi tên phường mới sau sắp xếp 2025)
            if name in WARD_CODES.values() and g is not None:
                self.pts.append(g.representative_point())
                self.names.append(name)
        self.tree = STRtree(self.pts)

    def __call__(self, g):
        if g is None:
            return None
        return self.names[self.tree.nearest(g.representative_point())]


def norm_ward(v):
    v = clean(v)
    if not v:
        return None
    v = re.sub(r"(?i)^phường\s+", "", v)
    return WARD_CODES.get(v[-5:], v) if v.isdigit() else v


# ---------------------------------------------------------------- main

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    manifest = json.loads((RAW / "manifest.json").read_text(encoding="utf-8"))
    layer_names = {m["id"]: m["name"] for m in manifest}
    fetched_at = dt.datetime.fromtimestamp((RAW / "manifest.json").stat().st_mtime).isoformat(timespec="minutes")

    ranh = load(80)        # Ranh quy hoạch chung (ranh đồ án)
    sdd_qhc = load(82)     # Sử dụng đất quy hoạch chung
    sdd_qhpk = load(90)    # Sử dụng đất quy hoạch phân khu
    tim_qhc = load(84)     # Tim đường quy hoạch chung
    tim_qhpk = load(92)    # Tim đường giao thông quy hoạch phân khu
    duong_qhc = load(86)   # Đường giao thông quy hoạch chung (mặt đường — ranh lộ giới)
    norl = load(96)        # Công trình nhà ở riêng lẻ
    sonha = load(98)       # Cấp phép số nhà
    gpxd = load(102)       # Giấy phép xây dựng
    ttxd = load(100)       # Trật tự xây dựng
    ht = load(76)          # Hiện trạng sử dụng đất
    kh = load(78)          # Kế hoạch sử dụng đất
    qh = load(74)          # Quy hoạch sử dụng đất
    thua = load(147)       # Địa chính - Thửa đất

    ward_of = WardLocator([(norm_ward(p.get("phuong_xa")), g) for p, g in sonha] +
                          [(norm_ward(p.get("phuongxa")), g) for p, g in thua])
    wards = sorted(set(ward_of.names))
    dq = []  # cảnh báo chất lượng dữ liệu

    # ============================================================ 1. QUY HOẠCH
    plans = []
    for p, g in ranh:
        name = clean(p.get("ten_doan_qhc"))
        date = clean(p.get("ngay_duyet"))
        year = int(date[-4:]) if date and re.search(r"\d{4}$", date) else None
        plans.append({
            "id": clean(p.get("id")), "name": name, "status": clean(p.get("trang_thai")),
            "approver": clean(p.get("coquan_pheduyet")), "decision": clean(p.get("so_qd")),
            "date": date, "year": year, "area_ha": r1(true_area(g) / 1e4),
            "pop_plan": p.get("danso_quyhoach") or 0, "ward": ward_of(g),
        })
    named = [x for x in plans if x["name"]]
    unnamed = len(plans) - len(named)
    if unnamed:
        dq.append({"layer": layer_names[80], "issue": f"{unnamed} ranh đồ án không có tên, trạng thái, quyết định duyệt",
                   "impact": "Không thống kê được các ranh này; chỉ thể hiện trên bản đồ"})
    union_ranh = shapely.union_all([g for _, g in ranh if g is not None])
    plan_years = collections.Counter(x["year"] for x in named if x["year"])
    approvers = collections.Counter(x["approver"] for x in named if x["approver"])
    statuses = collections.Counter(x["status"] or "Chưa có thông tin" for x in plans)

    # Cơ cấu sử dụng đất quy hoạch chung (theo diện tích hình học thật)
    qhc_area = collections.Counter()
    unmatched = collections.Counter()
    for p, g in sdd_qhc:
        grp = group_qh(p.get("chuc_nang"))
        if grp == "Khác":
            unmatched[clean(p.get("chuc_nang"))] += 1
        qhc_area[grp] += true_area(g) / 1e4
    qhc_total = sum(qhc_area.values())

    # Chỉ tiêu tầng cao quy hoạch phân khu (dùng cho đối chiếu công trình)
    qhpk_floor = [(int(p.get("chieucao_tang") or 0), grp, g) for p, g in sdd_qhpk
                  for grp in [group_qh(p.get("chưc_nang"))] if g is not None and grp not in OPEN_GROUPS]

    print(f"Quy hoạch: {len(named)}/{len(plans)} đồ án có thông tin, gộp chồng lấn {true_area(union_ranh)/1e4:.0f} ha")
    if unmatched:
        print("  Chức năng chưa phân nhóm (top):", unmatched.most_common(8))

    # ============================================================ 2. HẠ TẦNG GIAO THÔNG QUY HOẠCH
    def road_stats(rows, lg_key="lo_gioi"):
        bins = [("< 12 m", 0, 12), ("12–20 m", 12, 20), ("20–30 m", 20, 30), ("30–60 m", 30, 60), ("≥ 60 m", 60, 1e9)]
        km = collections.Counter()
        total = 0.0
        no_lg = 0
        for p, g in rows:
            L = true_length(g) / 1000
            total += L
            lg = p.get(lg_key) or 0
            if lg <= 0:
                no_lg += 1
                km["Chưa có lộ giới"] += L
                continue
            for lab, lo, hi in bins:
                if lo <= lg < hi:
                    km[lab] += L
        order = [b[0] for b in bins] + (["Chưa có lộ giới"] if no_lg else [])
        return {"total_km": r1(total), "segments": len(rows), "no_logioi": no_lg,
                "by_logioi": [{"label": k, "value": r1(km[k])} for k in order]}

    roads = {"qhc": road_stats(tim_qhc), "qhpk": road_stats(tim_qhpk)}
    road_polys = [g for _, g in duong_qhc if g is not None]
    road_union = shapely.union_all(road_polys)
    road_tree = STRtree(road_polys)
    print(f"Giao thông: QHC {roads['qhc']['total_km']} km, QHPK {roads['qhpk']['total_km']} km")

    # ============================================================ 3. CẤP PHÉP XÂY DỰNG
    permits = []
    capital_bad = 0
    for p, g in gpxd:
        code = clean(p.get("MSHS"))
        kind, year = ho_so_info(code)
        ward = norm_ward(p.get("Phuong_Xa"))
        new_ward = ward == "Hiệp Bình"  # tên phường mới sau sắp xếp 2025
        ward_old = ward if ward in WARD_CODES.values() else ward_of(g)
        gfa = p.get("TongDTSan_CT")
        floors = p.get("SoTangCao")
        # diện tích sàn > 2 × (diện tích nền đo trên bản đồ × số tầng) → nhập sai, không cộng vào tổng
        gfa_bad = bool(gfa and g is not None and gfa > 2 * true_area(g) * max(floors or 1, 1))
        cap = p.get("TongVonDauTu_CT")
        if cap and cap > SUSPECT_CAPITAL:
            capital_bad += 1
            cap = None
        permits.append({
            "code": code, "kind": kind, "year": year, "ward": ward_old, "new_ward": new_ward,
            "name": clean(p.get("Ten_CT")), "floors": floors, "gfa": None if gfa_bad else gfa, "gfa_bad": gfa_bad,
            "capital": cap, "group": p.get("NhomCongTrinh"),
            "dossier_issue": clean(p.get("MoTaTinhTrangHoSo")), "survey_year": p.get("NamKS"),
            "geom": g,
        })
    projects = [x for x in permits if x["kind"]]          # hồ sơ công trình/dự án lưu trữ
    house_permits = [x for x in permits if not x["kind"]]  # GPXD nhà ở riêng lẻ (mã thuần số)
    gfa_bad_n = sum(1 for x in permits if x["gfa_bad"])
    if gfa_bad_n:
        dq.append({"layer": layer_names[102], "issue": f"{gfa_bad_n} hồ sơ có tổng diện tích sàn lớn hơn 2 lần (diện tích nền đo trên bản đồ × số tầng)",
                   "impact": "Đã loại khỏi tổng diện tích sàn và bảng xếp hạng"})
    if all(not x["floors"] for x in permits if not x["kind"]):
        dq.append({"layer": layer_names[102], "issue": "116 GPXD nhà ở riêng lẻ (phường Hiệp Bình) chỉ có số nhà, đường, thửa, chủ sở hữu; không có số tầng, diện tích, năm cấp",
                   "impact": "Chỉ đếm số giấy phép"})
    if capital_bad:
        dq.append({"layer": layer_names[102], "issue": f"{capital_bad} hồ sơ khai vốn đầu tư > 50.000 tỷ đồng/công trình",
                   "impact": "Đã loại khỏi tổng vốn đầu tư"})
    dq.append({"layer": layer_names[102], "issue": "Phường ghi lẫn mã số (76226800…), tên phường mới (“phường Hiệp Bình”) hoặc để trống",
               "impact": "Đã chuẩn hóa về 12 phường cũ theo mã và theo vị trí"})
    dq.append({"layer": layer_names[102], "issue": "Loai_CT, Cap_CT, NguonVon (“NNY”, “YYN”…) chỉ có mã, chưa có bảng tra",
               "impact": "Chưa thống kê theo loại/cấp công trình, nguồn vốn"})

    def by_ward(items, key="ward"):
        c = collections.Counter(x[key] for x in items if x.get(key))
        return [{"label": w, "value": c.get(w, 0)} for w in sorted(wards, key=lambda w: -c.get(w, 0))]

    kinds = collections.Counter(x["kind"] for x in projects)
    proj_years = collections.Counter(x["year"] for x in projects)
    floors_bins = [("1–3 tầng", 1, 3), ("4–9 tầng", 4, 9), ("10–19 tầng", 10, 19), ("≥ 20 tầng", 20, 999)]

    def floor_hist(vals):
        c = collections.Counter()
        for v in vals:
            for lab, lo, hi in floors_bins:
                if v and lo <= v <= hi:
                    c[lab] += 1
        return [{"label": b[0], "value": c.get(b[0], 0)} for b in floors_bins]

    dossier_issues = [x for x in projects if x["dossier_issue"]]
    top_projects = sorted([x for x in projects if x["gfa"]], key=lambda x: -x["gfa"])[:10]

    # ============================================================ 4. TRẬT TỰ XÂY DỰNG + PHÂN TÍCH CHÉO
    permit_codes = {x["code"] for x in projects}
    permit_geoms = [x["geom"] for x in permits if x["geom"] is not None] + [g for _, g in norl if g is not None]
    permit_tree = STRtree(permit_geoms)
    qhpk_tree = STRtree([q[2] for q in qhpk_floor])
    qhc_geoms = [(group_qh(p.get("chuc_nang")), g) for p, g in sdd_qhc if g is not None]
    qhc_tree = STRtree([g for _, g in qhc_geoms])

    sites = []
    for p, g in ttxd:
        if g is None:
            continue
        code = clean(p.get("id"))
        kind, year = ho_so_info(code)
        floors = p.get("so_tang") or 0
        area = true_area(g)
        # (a) đối chiếu hồ sơ cấp phép: theo mã, hoặc chồng lấn ≥ 30% diện tích với một công trình được cấp phép
        linked = code in permit_codes
        if not linked:
            for i in permit_tree.query(g, predicate="intersects"):
                if permit_geoms[i].intersection(g).area >= 0.3 * g.area:
                    linked = True
                    break
        # (b) lấn ranh lộ giới đường quy hoạch chung
        enc = sum(road_polys[i].intersection(g).area for i in road_tree.query(g, predicate="intersects"))
        enc_ratio = min(enc / g.area, 1.0) if g.area else 0
        # (c) chức năng quy hoạch chung tại vị trí công trình (theo diện tích chồng lấn lớn nhất)
        best, best_a = None, 0
        for i in qhc_tree.query(g, predicate="intersects"):
            a = qhc_geoms[i][1].intersection(g).area
            if a > best_a:
                best, best_a = qhc_geoms[i][0], a
        # (d) vượt tầng cao tối đa theo quy hoạch phân khu (nếu có chỉ tiêu)
        max_floor = None
        for i in qhpk_tree.query(g.representative_point(), predicate="intersects"):
            if qhpk_floor[i][0] > 0:
                max_floor = qhpk_floor[i][0]
        flags = []
        if not linked:
            flags.append("no_permit")
        if enc_ratio >= ROAD_SITE_RATIO:
            flags.append("road")
        if best in OPEN_GROUPS and best_a >= 0.5 * g.area:
            flags.append("landuse")
        if max_floor and floors > max_floor:
            flags.append("height")
        sites.append({"i": len(sites), "code": code, "kind": kind, "year": year, "floors": floors, "height": p.get("chieu_cao"),
                      "area": round(area), "ward": ward_of(g), "linked": linked, "enc": round(enc_ratio, 2),
                      "qh_func": best, "max_floor": max_floor, "flags": flags, "geom": g})

    flag_labels = {
        "no_permit": "Chưa đối chiếu được hồ sơ cấp phép",
        "road": f"Lấn ranh lộ giới quy hoạch (≥ {ROAD_SITE_RATIO:.0%} diện tích)",
        "landuse": "Nằm trên đất cây xanh / giao thông / mặt nước theo QHC",
        "height": "Vượt tầng cao tối đa theo QHPK",
    }
    flag_counts = collections.Counter(f for s in sites for f in s["flags"])
    flagged = [s for s in sites if s["flags"]]
    print(f"Trật tự XD: {len(sites)} công trình, {len(flagged)} có ít nhất một dấu hiệu: {dict(flag_counts)}")

    # Thửa đất / GCN nằm trong lộ giới quy hoạch (ảnh hưởng giải tỏa)
    parcel_rows = [(p, g) for p, g in thua if g is not None]
    parcel_hit, parcel_hit_area = 0, 0.0
    for p, g in parcel_rows:
        a = sum(road_polys[i].intersection(g).area for i in road_tree.query(g, predicate="intersects"))
        if g.area and a / g.area >= ROAD_PARCEL_RATIO:
            parcel_hit += 1
            parcel_hit_area += a * scale_at(g.centroid.y) ** 2

    # ============================================================ 5. ĐẤT ĐAI
    def land_mix(rows, key):
        by_grp, by_code = collections.Counter(), collections.Counter()
        for p, g in rows:
            code = clean(p.get(key)) or "?"
            a = true_area(g) / 1e4
            by_code[code] += a
            by_grp[LAND_CODES.get(code, (code, "Khác"))[1]] += a
        return by_grp, by_code

    ht_grp, ht_code = land_mix(ht, "ten_loaidat")
    qh_grp, qh_code = land_mix(qh, "ten_loaidat")
    ht_tot, qh_tot = sum(ht_grp.values()), sum(qh_grp.values())
    grp_order = sorted(set(ht_grp) | set(qh_grp), key=lambda k: -(ht_grp[k] / ht_tot + qh_grp[k] / qh_tot))
    land_compare = [{"label": k, "ht_ha": r1(ht_grp[k]), "qh_ha": r1(qh_grp[k]),
                     "ht_pct": r1(100 * ht_grp[k] / ht_tot), "qh_pct": r1(100 * qh_grp[k] / qh_tot)} for k in grp_order]
    dq.append({"layer": layer_names[74], "issue": "Tất cả 608 vùng có cùng tên dự án, năm, quy mô (“Nhà ở riêng lẻ”, 28/05/2025); kh_loaidat đều là “TSC”",
               "impact": "Chỉ dùng mã loại đất (ten_loaidat) để thống kê"})

    kh_items = []
    for p, g in kh:
        code = clean(p.get("kyhieu_kh"))
        kh_items.append({"name": clean(p.get("tenvung_kh")), "code": code, "type": clean(p.get("loaidat_kh")),
                         "current": clean(p.get("loaidat_ht")), "area_ha": r1(true_area(g) / 1e4),
                         "note": clean(p.get("ghi_chu")), "ward": ward_of(g)})
    kh_by_type = collections.Counter()
    for x in kh_items:
        kh_by_type[x["type"] or "Chưa có thông tin"] += x["area_ha"]

    parcels_attr = [p for p, _ in thua if clean(p.get("phuongxa"))]
    if len(parcels_attr) < len(thua):
        dq.append({"layer": layer_names[147], "issue": f"{len(thua) - len(parcels_attr)}/{len(thua)} thửa chỉ có hình học, không có thuộc tính",
                   "impact": "Thống kê thửa/GCN chỉ dựa trên phần có thuộc tính"})
    gcn = sum(1 for p in parcels_attr if clean(p.get("gcn")))
    sonha_by_ward = collections.Counter(norm_ward(p.get("phuong_xa")) for p, _ in sonha)
    if all(not p.get("nam_capphep") for p, _ in sonha):
        dq.append({"layer": layer_names[98], "issue": "Không có năm cấp số nhà, loại số nhà",
                   "impact": "Không vẽ được xu hướng cấp số nhà theo thời gian"})
    if all(str(p.get("nam_capphep", "")).startswith("1970") for p, _ in ttxd):
        dq.append({"layer": layer_names[100], "issue": "nam_capphep đều là 01/01/1970 (giá trị mặc định); ten_phuongxa để trống",
                   "impact": "Năm lấy từ mã hồ sơ; phường gán theo vị trí"})
    dq.append({"layer": f"{layer_names[80]} / {layer_names[88]}", "issue": "Hai lớp chứa cùng 47 đồ án (trùng tên, diện tích, quyết định)",
               "impact": "Chỉ đếm một lần"})

    # ============================================================ 6. CẢNH BÁO CHO LÃNH ĐẠO
    alerts = []
    if flag_counts["road"]:
        alerts.append({"level": "critical", "title": f"{flag_counts['road']} công trình lấn ranh lộ giới quy hoạch",
                       "detail": f"Từ {ROAD_SITE_RATIO:.0%} diện tích nền trở lên nằm trong ranh đường quy hoạch chung", "filter": "road"})
    if flag_counts["no_permit"]:
        alerts.append({"level": "serious", "title": f"{flag_counts['no_permit']} công trình chưa đối chiếu được hồ sơ cấp phép",
                       "detail": "Không khớp mã hồ sơ và không chồng lấn công trình được cấp phép nào", "filter": "no_permit"})
    if flag_counts["landuse"]:
        alerts.append({"level": "serious", "title": f"{flag_counts['landuse']} công trình trên đất cây xanh, giao thông, mặt nước theo QHC",
                       "detail": "Trên 50% diện tích công trình nằm trong ô đất có chức năng này", "filter": "landuse"})
    if flag_counts["height"]:
        alerts.append({"level": "warning", "title": f"{flag_counts['height']} công trình vượt tầng cao tối đa của QHPK",
                       "detail": "So số tầng hiện trạng với chỉ tiêu tầng cao của ô đất QHPK", "filter": "height"})
    if parcel_hit:
        alerts.append({"level": "warning", "title": f"{parcel_hit} thửa đất nằm trong lộ giới quy hoạch",
                       "detail": f"Từ {ROAD_PARCEL_RATIO:.0%} diện tích thửa trở lên; khoảng {parcel_hit_area / 1e4:.1f} ha có thể phải thu hồi khi mở đường", "filter": None})
    if dossier_issues:
        alerts.append({"level": "warning", "title": f"{len(dossier_issues)} hồ sơ cấp phép chưa hoàn chỉnh",
                       "detail": "Thiếu chứng từ sở hữu đất, PCCC hoặc bản vẽ mờ", "filter": None})

    # ============================================================ 7. XUẤT BẢN ĐỒ
    sizes = {}
    sizes["ranh_qh"] = write_geo("ranh_qh", ranh, lambda p, g: {
        "ten": clean(p.get("ten_doan_qhc")) or "(chưa có tên)", "qd": clean(p.get("so_qd")),
        "ngay": clean(p.get("ngay_duyet")), "cq": clean(p.get("coquan_pheduyet")),
        "ha": r1(true_area(g) / 1e4), "ds": p.get("danso_quyhoach")}, tolerance=2)
    sizes["sdd_qhc"] = write_geo("sdd_qhc", sdd_qhc, lambda p, g: {
        "cn": clean(p.get("chuc_nang")), "nhom": group_qh(p.get("chuc_nang")), "ma": clean(p.get("ma_quyuoc")),
        "ha": round(true_area(g) / 1e4, 2)}, tolerance=1.5)
    sizes["hien_trang"] = write_geo("hien_trang", ht, lambda p, g: {
        "ma": clean(p.get("ten_loaidat")),
        "ten": LAND_CODES.get(clean(p.get("ten_loaidat")) or "", ("Chưa xác định", ""))[0],
        "nhom": LAND_CODES.get(clean(p.get("ten_loaidat")) or "", ("", "Khác"))[1],
        "ha": round(true_area(g) / 1e4, 2)}, tolerance=1.5)
    sizes["qh_sdd"] = write_geo("qh_sdd", qh, lambda p, g: {
        "ma": clean(p.get("ten_loaidat")),
        "ten": LAND_CODES.get(clean(p.get("ten_loaidat")) or "", ("Chưa xác định", ""))[0],
        "nhom": LAND_CODES.get(clean(p.get("ten_loaidat")) or "", ("", "Khác"))[1],
        "ha": round(true_area(g) / 1e4, 2)}, tolerance=1.5)
    sizes["kh_sdd"] = write_geo("kh_sdd", kh, lambda p, g: {
        "ten": clean(p.get("tenvung_kh")), "loai": clean(p.get("loaidat_kh")), "ht": clean(p.get("loaidat_ht")),
        "ghichu": clean(p.get("ghi_chu")), "ha": r1(true_area(g) / 1e4)}, tolerance=1)
    sizes["tim_duong"] = write_geo("tim_duong", tim_qhc, lambda p, g: {
        "ten": clean(p.get("ten_duong")), "lg": p.get("lo_gioi"), "km": round(true_length(g) / 1000, 2),
        "tt": clean(p.get("trang_thai"))}, tolerance=2)
    sizes["gpxd"] = write_geo("gpxd", [(x, x["geom"]) for x in permits], lambda x, g: {
        "ma": x["code"], "loai": HOSO_TYPES.get(x["kind"], "GPXD nhà ở riêng lẻ"), "nam": x["year"],
        "ten": x["name"], "tang": x["floors"], "san": x["gfa"], "phuong": x["ward"],
        "hoso": x["dossier_issue"]}, as_point=True)
    sizes["ttxd"] = write_geo("ttxd", [(s, s["geom"]) for s in sites], lambda s, g: {
        "i": s["i"], "ma": s["code"], "tang": s["floors"], "cao": s["height"], "m2": s["area"], "phuong": s["ward"],
        "cp": s["linked"], "lgpct": round(100 * s["enc"]), "qh": s["qh_func"], "tmax": s["max_floor"],
        "flags": s["flags"]}, as_point=True)
    sizes["thua"] = write_geo("thua", thua, lambda p, g: {
        "to": p.get("soto"), "thua": p.get("sothua"), "phuong": norm_ward(p.get("phuongxa")) or ward_of(g),
        "m2": round(true_area(g)), "gcn": bool(clean(p.get("gcn")))}, tolerance=0.3)
    for k, (n, b) in sizes.items():
        print(f"  geo/{k}.geojson: {n} đối tượng, {b / 1e6:.2f} MB")

    # ============================================================ 8. SUMMARY
    gfa_total = sum(x["gfa"] or 0 for x in projects)
    capital_total = sum(x["capital"] or 0 for x in projects)
    summary = {
        "generated_at": dt.datetime.now().isoformat(timespec="minutes"),
        "fetched_at": fetched_at,
        "source": "https://nextgis.hcmgis.vn/api/resource/62/wfs",
        "area_name": "TP Thủ Đức – khu vực Quận Thủ Đức cũ",
        "bounds": bbox4326([g for _, g in ranh]),
        "wards": wards,
        "layers": manifest,
        "kpi": {
            "plans_total": len(plans), "plans_named": len(named),
            "plans_approved": sum(1 for x in plans if x["status"] == "Đã duyệt"),
            "plans_area_ha": round(true_area(union_ranh) / 1e4),
            "plans_pop": round(sum(x["pop_plan"] for x in named)),
            "projects": len(projects), "house_permits": len(house_permits),
            "gfa_m2": round(gfa_total), "capital_bn": round(capital_total / 1e9),
            "capital_n": sum(1 for x in projects if x["capital"]),
            "sites": len(sites), "sites_flagged": len(flagged),
            "parcels": len(thua), "parcels_attr": len(parcels_attr), "gcn": gcn,
            "sonha": len(sonha),
            "road_km": roads["qhc"]["total_km"],
            "road_reserve_ha": round(true_area(road_union) / 1e4),
        },
        "planning": {
            "by_year": [{"label": str(y), "value": plan_years[y]} for y in sorted(plan_years)],
            "by_approver": counter_list(approvers),
            "by_status": counter_list(statuses),
            "top_area": sorted([{k: x[k] for k in ("name", "area_ha", "pop_plan", "year", "approver", "decision")}
                                for x in named], key=lambda x: -x["area_ha"])[:10],
            "plans": [{k: x[k] for k in ("name", "status", "approver", "decision", "date", "year", "area_ha", "pop_plan", "ward")}
                      for x in named],
            "qhc_mix": [{"label": k, "ha": r1(v), "pct": r1(100 * v / qhc_total)}
                        for k, v in qhc_area.most_common()],
        },
        "roads": roads,
        "construction": {
            "by_ward_projects": by_ward(projects),
            "by_kind": [{"label": HOSO_TYPES.get(k, k), "value": v} for k, v in kinds.most_common()],
            "by_year": [{"label": str(y), "value": proj_years[y]} for y in range(min(proj_years), max(proj_years) + 1)],
            "floors": floor_hist([x["floors"] for x in projects]),
            "house_permits_ward": "Hiệp Bình (phường mới)",
            "house_floors": floor_hist([x["floors"] for x in house_permits]),
            "top_gfa": [{"name": x["name"], "code": x["code"], "gfa": x["gfa"], "floors": x["floors"], "ward": x["ward"]}
                        for x in top_projects],
            "dossier_issues": counter_list(collections.Counter(
                re.sub(r"\s+", " ", x["dossier_issue"]).lower() for x in dossier_issues)),
            "projects": [{"code": x["code"], "kind": HOSO_TYPES.get(x["kind"]), "year": x["year"], "ward": x["ward"],
                          "name": x["name"], "floors": x["floors"], "gfa": x["gfa"], "capital": x["capital"],
                          "issue": x["dossier_issue"]} for x in projects],
        },
        "order": {
            "flag_labels": flag_labels,
            "flags": [{"key": k, "label": flag_labels[k], "value": flag_counts.get(k, 0)} for k in flag_labels],
            "by_ward": by_ward(sites),
            "by_ward_flagged": by_ward(flagged),
            "floors": floor_hist([s["floors"] for s in sites]),
            "linked": sum(1 for s in sites if s["linked"]),
            "sites": [{k: s[k] for k in ("i", "code", "floors", "area", "ward", "linked", "enc", "qh_func", "max_floor", "flags")}
                      for s in sites],
            "parcels_in_road": parcel_hit, "parcels_in_road_ha": r1(parcel_hit_area / 1e4),
        },
        "land": {
            "compare": land_compare, "ht_total_ha": round(ht_tot), "qh_total_ha": round(qh_tot),
            "ht_codes": [{"code": k, "name": LAND_CODES.get(k, (k,))[0], "ha": r1(v)} for k, v in ht_code.most_common()],
            "kh_by_type": [{"label": k, "value": r1(v)} for k, v in kh_by_type.most_common()],
            "kh_items": sorted(kh_items, key=lambda x: -x["area_ha"]),
            "sonha_by_ward": [{"label": w, "value": sonha_by_ward.get(w, 0)}
                              for w in sorted(wards, key=lambda w: -sonha_by_ward.get(w, 0))],
        },
        "alerts": alerts,
        "data_quality": dq,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print("KPI:", json.dumps(summary["kpi"], ensure_ascii=False))
    print("Cảnh báo:", [a["title"] for a in alerts])


if __name__ == "__main__":
    main()
