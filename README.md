# Bảng điều hành Đất đai – Quy hoạch – Xây dựng

Dashboard cho lãnh đạo, dữ liệu từ dịch vụ WFS NextGIS của HCMGIS
(`https://nextgis.hcmgis.vn/api/resource/62/wfs`, 16 lớp, khu vực Quận Thủ Đức cũ).

Dữ liệu chia theo 3 lĩnh vực như trong nguồn WFS:

- **Đất đai**: Hiện trạng sử dụng đất, Kế hoạch sử dụng đất, Quy hoạch sử dụng đất, Địa chính – Thửa đất
- **Quy hoạch**: Quy hoạch sử dụng đất QHC, Ranh QHC, Ranh đồ án QHPK, Sử dụng đất QHPK, Tim đường QHPK/QHC, Đường giao thông QHC/QHPK
- **Xây dựng**: Công trình nhà ở riêng lẻ, Cấp phép số nhà, Giấy phép xây dựng, Trật tự xây dựng

Gồm 5 mục: **Tổng quan** (KPI, cảnh báo, bản đồ tổng hợp) · **Đất đai** (hai bản đồ so sánh hiện trạng/quy hoạch chạy đồng bộ) ·
**Quy hoạch** · **Xây dựng** (cấp phép xây dựng, cấp số nhà, trật tự xây dựng) · **Chất lượng dữ liệu**.
Có bộ lọc theo phường và giao diện sáng/tối.

## Chạy

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt

.venv\Scripts\python etl\fetch.py     # tải 16 lớp về data\raw\ (~60 MB, 1–2 phút)
.venv\Scripts\python etl\build.py     # làm sạch + phân tích → public\data\ (~10 giây)

python -m http.server 8765 -d public  # mở http://localhost:8765
```

Để cập nhật dữ liệu định kỳ, chạy lại `fetch.py` và `build.py` (ví dụ bằng Task Scheduler hằng đêm).
Thư mục `public/` là trang tĩnh, đưa lên bất kỳ máy chủ web nào cũng chạy được.

## Vì sao cần bước ETL

- WFS chỉ trả GML 3.2, tối đa 1000 đối tượng/lần (lớp SDĐ quy hoạch chung có 2.477). `fetch.py` dùng
  API xuất `/api/resource/{id}/geojson` của NextGIS để lấy trọn lớp.
- Máy chủ không trả header CORS, nên trình duyệt không gọi trực tiếp được. Dashboard đọc file JSON tĩnh đã xử lý.
- Phân tích chéo giữa các lớp (giao không gian) quá nặng để làm trong trình duyệt.

## Các phép xử lý chính (`etl/build.py`)

| Nội dung | Cách làm |
|---|---|
| Diện tích, chiều dài | Tính từ hình học (EPSG:3857 có hiệu chỉnh hệ số tỷ lệ theo vĩ độ), không dùng trường thuộc tính vì đơn vị không thống nhất (m², ha) |
| Phường | Dữ liệu không có lớp ranh giới hành chính. Mã phường trong GPXD (`76226800`…) được đổi sang tên. Các bản ghi khác gán theo thửa có tên phường gần nhất (lớp Cấp phép số nhà, Thửa đất). Đã kiểm chứng: phường suy ra từ vị trí trùng với mã phường ghi trong hồ sơ ở 211/223 hồ sơ GPXD (94,6%) |
| Hồ sơ cấp phép | 235 hồ sơ công trình, dự án (mã `GPXD-2013-45`, `TĐDA-…`; năm lấy từ mã) tách riêng 116 GPXD nhà ở riêng lẻ (mã thuần số, phường Hiệp Bình mới) |
| Trật tự xây dựng: đối chiếu cấp phép | Khớp mã hồ sơ, hoặc chồng lấn ≥ 30% diện tích với công trình trong lớp GPXD / Nhà ở riêng lẻ |
| Lấn lộ giới | ≥ 20% diện tích nền công trình (≥ 30% với thửa đất) nằm trong lớp *Đường giao thông quy hoạch chung* |
| Sai chức năng quy hoạch | > 50% diện tích công trình nằm trên ô đất cây xanh, giao thông, mặt nước của QH chung |
| Vượt tầng cao | Số tầng hiện trạng lớn hơn `chieucao_tang` của ô đất QH phân khu (bỏ qua ô cây xanh, giao thông, mặt nước) |
| Nhóm chức năng đất | Mã loại đất (ODT, DGT…) và tên chức năng QH (văn bản tự do) được gộp thành ~13 nhóm theo từ khóa, xem `LAND_CODES`, `QH_GROUPS` |
| Số liệu bất thường | Vốn > 50.000 tỷ/công trình; diện tích sàn > 2 × (diện tích nền × số tầng): loại khỏi tổng, ghi ở mục Chất lượng dữ liệu |

Các ngưỡng nằm ở đầu `build.py` (`ROAD_SITE_RATIO`, `ROAD_PARCEL_RATIO`, `SUSPECT_CAPITAL`) và chỉnh được.
**Kết quả đối chiếu là tự động, dùng để khoanh vùng kiểm tra, chưa phải kết luận vi phạm.**

## Dữ liệu cá nhân

Dữ liệu gốc có họ tên chủ sở hữu (GPXD, thửa đất, cấp số nhà). `build.py` không đưa trường này vào `public/data/`.

## Cấu trúc

```
etl/fetch.py        tải dữ liệu thô
etl/build.py        làm sạch, phân tích, xuất JSON/GeoJSON
public/index.html   trang dashboard
public/js/app.js    biểu đồ (ECharts), bản đồ (Leaflet), bộ lọc
public/css/style.css
public/data/        summary.json + geo/*.geojson (sinh tự động)
data/raw/           GeoJSON gốc (sinh tự động, không cần lưu)
```
