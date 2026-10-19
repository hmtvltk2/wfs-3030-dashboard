/* Bảng điều hành Quy hoạch – Xây dựng – Đất đai
 * Đọc data/summary.json + data/geo/*.geojson (sinh bởi etl/build.py). */
(() => {
  "use strict";

  // ------------------------------------------------------------------ hằng số
  // Màu nhóm chức năng đất theo quy ước bản đồ quy hoạch (vàng = ở, xanh lá = cây xanh, xám = giao thông…)
  const LAND_COLORS = {
    "Nhà ở": "#f2c14e",
    "Hỗn hợp": "#e8875b",
    "Thương mại – dịch vụ": "#e05a5a",
    "Công cộng – cơ quan": "#c86fb0",
    "Giáo dục": "#f19bc0",
    "Cây xanh – TDTT": "#5cae5c",
    "Giao thông": "#a3a3a3",
    "Mặt nước – thủy lợi": "#5aa9e6",
    "Công nghiệp – sản xuất": "#9b7fd1",
    "Tôn giáo – tín ngưỡng": "#b78553",
    "Hạ tầng kỹ thuật": "#6f8f99",
    "Nông nghiệp": "#b8d86b",
    "Nghĩa trang": "#6b6b6b",
    "Khác": "#d4d2cb",
  };
  // Mức độ dấu hiệu trật tự xây dựng → token trạng thái (luôn đi kèm biểu tượng + nhãn)
  const SEVERITY = {
    critical: { label: "Nghiêm trọng", icon: "!", var: "--critical" },
    serious: { label: "Cần xử lý", icon: "▲", var: "--serious" },
    warning: { label: "Theo dõi", icon: "●", var: "--warning" },
  };
  const FLAG_SEVERITY = { road: "critical", no_permit: "serious", landuse: "serious", height: "warning" };
  const FLAG_ORDER = ["road", "no_permit", "landuse", "height"];

  const nf = new Intl.NumberFormat("vi-VN");
  const nf1 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
  const fmt = (v) => (v == null || Number.isNaN(v) ? "—" : nf.format(Math.round(v)));
  const fmt1 = (v) => (v == null ? "—" : nf1.format(v));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel) => document.querySelector(sel);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const countBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); if (k != null) m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());

  const state = { S: null, ward: "", flag: "", geo: {}, charts: {}, siteMarkers: new Map() };

  // ------------------------------------------------------------------ theme
  const THEME_KEY = "wfs-dashboard-theme";
  function applyStoredTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t) document.documentElement.dataset.theme = t;
    } catch (_) { /* bộ nhớ trình duyệt không khả dụng */ }
  }
  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t) return t === "dark";
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function toggleTheme() {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* bỏ qua */ }
    onThemeChange();
  }

  // ------------------------------------------------------------------ ECharts helpers
  function baseOption() {
    const text2 = css("--text-secondary"), muted = css("--text-muted");
    return {
      animationDuration: 300,
      textStyle: { fontFamily: getComputedStyle(document.body).fontFamily, color: text2 },
      grid: { left: 16, right: 48, top: 12, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: css("--grid"), opacity: 0.5 } },
        backgroundColor: css("--surface-1"), borderColor: css("--border"), borderWidth: 1,
        textStyle: { color: css("--text-primary"), fontSize: 12 }, extraCssText: "box-shadow:0 4px 12px rgba(0,0,0,.12);border-radius:8px;",
      },
      _axis: {
        axisLine: { lineStyle: { color: css("--axis") } }, axisTick: { show: false },
        axisLabel: { color: muted, fontSize: 11 }, splitLine: { lineStyle: { color: css("--grid"), type: "solid" } },
      },
    };
  }
  function chart(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    let c = state.charts[id];
    if (!c) { c = echarts.init(el, null, { renderer: "svg" }); state.charts[id] = c; }
    return c;
  }
  const valueAxisLabel = (v) => (v >= 1000 ? nf1.format(v / 1000) + "K" : nf.format(v));

  /** Biểu đồ thanh ngang một chuỗi. highlight: nhãn được nhấn mạnh, các thanh khác chuyển xám. */
  function barH(id, items, { unit = "", highlight = "", color = css("--series-1"), digits = 0, labelWidth = 150 } = {}) {
    const c = chart(id); if (!c) return;
    const b = baseOption(), soft = css("--axis");
    const data = items.slice().reverse();
    const f = digits ? fmt1 : fmt;
    c.setOption({
      ...b,
      grid: { ...b.grid, right: 56 },
      tooltip: { ...b.tooltip, formatter: (p) => `${esc(p[0].name)}<br><b>${f(p[0].value)}</b> ${unit}` },
      xAxis: { type: "value", ...b._axis, axisLabel: { ...b._axis.axisLabel, formatter: valueAxisLabel }, axisLine: { show: false } },
      yAxis: { type: "category", data: data.map((d) => d.label), ...b._axis, splitLine: { show: false },
        axisLabel: { color: css("--text-secondary"), fontSize: 12, width: labelWidth, overflow: "truncate" } },
      series: [{
        type: "bar", data: data.map((d) => ({
          value: d.value,
          itemStyle: { color: highlight && d.label !== highlight ? soft : color, borderRadius: [0, 4, 4, 0] },
        })),
        barMaxWidth: 18, barCategoryGap: "30%",
        label: { show: true, position: "right", color: css("--text-secondary"), fontSize: 11, formatter: (p) => f(p.value) },
      }],
    }, true);
  }

  /** Biểu đồ cột một chuỗi theo trục danh mục/thời gian. */
  function column(id, items, { unit = "", color = css("--series-1"), labelMax = true } = {}) {
    const c = chart(id); if (!c) return;
    const b = baseOption();
    const max = Math.max(...items.map((d) => d.value));
    c.setOption({
      ...b,
      grid: { ...b.grid, right: 12, top: 20 },
      tooltip: { ...b.tooltip, formatter: (p) => `${esc(p[0].name)}<br><b>${fmt(p[0].value)}</b> ${unit}` },
      xAxis: { type: "category", data: items.map((d) => d.label), ...b._axis, splitLine: { show: false } },
      yAxis: { type: "value", ...b._axis, minInterval: 1, axisLine: { show: false }, axisLabel: { ...b._axis.axisLabel, formatter: valueAxisLabel } },
      series: [{
        type: "bar", data: items.map((d) => d.value), barMaxWidth: 24,
        itemStyle: { color, borderRadius: [4, 4, 0, 0] },
        label: { show: labelMax, position: "top", color: css("--text-secondary"), fontSize: 11,
          formatter: (p) => (p.value === max && max > 0 ? fmt(p.value) : "") },
      }],
    }, true);
  }

  /** Thanh ngang nhiều chuỗi (nhóm hoặc chồng). series: [{name, values, color}] */
  function multiBarH(id, labels, series, { stacked = false, unit = "", digits = 0, legendEl = null, labelWidth = 150 } = {}) {
    const c = chart(id); if (!c) return;
    const b = baseOption();
    const f = digits ? fmt1 : fmt;
    const rev = labels.slice().reverse();
    c.setOption({
      ...b,
      tooltip: { ...b.tooltip, formatter: (ps) => `${esc(ps[0].name)}` + ps.map((p) =>
        `<br><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${p.color};margin-right:6px"></span>${esc(p.seriesName)}: <b>${f(p.value)}</b> ${unit}`).join("") },
      xAxis: { type: "value", ...b._axis, axisLine: { show: false }, axisLabel: { ...b._axis.axisLabel, formatter: valueAxisLabel } },
      yAxis: { type: "category", data: rev, ...b._axis, splitLine: { show: false },
        axisLabel: { color: css("--text-secondary"), fontSize: 12, width: labelWidth, overflow: "truncate" } },
      series: series.map((s, si) => ({
        name: s.name, type: "bar", stack: stacked ? "s" : undefined,
        data: s.values.slice().reverse(),
        barMaxWidth: stacked ? 18 : 10, barGap: "20%",
        itemStyle: {
          color: s.color,
          borderRadius: stacked ? (si === series.length - 1 ? [0, 4, 4, 0] : 0) : [0, 4, 4, 0],
          borderColor: stacked ? css("--surface-1") : undefined, borderWidth: stacked ? 1 : 0,
        },
      })),
    }, true);
    if (legendEl) legendEl.innerHTML = series.map((s) => `<li><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</li>`).join("");
  }

  // ------------------------------------------------------------------ tiles, alerts
  function renderHeader() {
    const S = state.S;
    $("#areaName").textContent = S.area_name;
    $("#fetchedAt").textContent = new Date(S.fetched_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
    const sel = $("#wardFilter");
    S.wards.forEach((w) => sel.insertAdjacentHTML("beforeend", `<option value="${esc(w)}">${esc(w)}</option>`));
    $("#srcLink").href = S.source; $("#srcLink").textContent = S.source;
  }

  const inWard = (x) => !state.ward || x.ward === state.ward;

  const pct = (a, b) => (b ? nf1.format((a / b) * 100) + "%" : "—");
  // số lớn → [giá trị gọn, đơn vị] để con số chính luôn ngắn
  const bigNum = (v, unit = "") => {
    if (v >= 1e6) return [nf1.format(v / 1e6), `triệu ${unit}`.trim()];
    if (v >= 1e4) return [nf1.format(v / 1e3), `nghìn ${unit}`.trim()];
    return [fmt(v), unit];
  };
  const statusIco = (lvl) => { const s = SEVERITY[lvl]; return `<span class="ico" style="background:var(${s.var})" title="${s.label}" aria-label="${s.label}">${s.icon}</span>`; };

  /** Dải số liệu đầu mỗi mục: [{v, u, l, key, lvl, delta}] */
  function renderStats(sel, items) {
    $(sel).innerHTML = items.map((s) => `<div class="stat${s.key ? " key" : ""}">${s.lvl ? `<span class="badge">${statusIco(s.lvl)}</span>` : ""}
      <div class="stat-v">${s.v}${s.u ? `<small>${esc(s.u)}</small>` : ""}${s.delta || ""}</div><div class="stat-l">${esc(s.l)}</div></div>`).join("");
  }

  function renderTiles() {
    const S = state.S, K = S.kpi;
    const plans = S.planning.plans.filter(inWard);
    const projects = S.construction.projects.filter(inWard);
    const sites = S.order.sites.filter(inWard);
    const flagged = sites.filter((s) => s.flags.length);
    const gfa = projects.reduce((a, x) => a + (x.gfa || 0), 0);
    const cap = projects.reduce((a, x) => a + (x.capital || 0), 0);
    const area = plans.reduce((a, x) => a + x.area_ha, 0), pop = plans.reduce((a, x) => a + (x.pop_plan || 0), 0);
    const issues = projects.filter((x) => x.issue).length;
    $("#heroValue").textContent = fmt(flagged.length);
    $("#heroTotal").textContent = fmt(sites.length);
    $("#heroPct").textContent = pct(flagged.length, sites.length);

    const counts = FLAG_ORDER.map((k) => sites.filter((s) => s.flags.includes(k)).length);
    const max = Math.max(1, ...counts);
    $("#flagRows").innerHTML = FLAG_ORDER.map((k, i) => {
      const sv = SEVERITY[FLAG_SEVERITY[k]];
      return `<button class="flag-row" type="button" data-filter="${k}" aria-pressed="${state.flag === k}" title="${esc(S.order.flag_labels[k])}">
        <span class="ico" style="background:var(${sv.var})" aria-label="${sv.label}">${sv.icon}</span>
        <span class="fl-label">${esc(shortFlag(k))}</span><span class="fl-v">${fmt(counts[i])}</span>
        <span class="fl-bar"><i style="width:${(counts[i] / max) * 100}%;background:var(${sv.var})"></i></span></button>`;
    }).join("");

    const [popV, popU] = bigNum(pop, "dân");
    const [gfaV, gfaU] = bigNum(gfa, "m²");
    const tiles = [
      { label: "Đồ án quy hoạch đã duyệt", value: fmt(plans.length), note: `<b>${fmt(area)}</b> ha` },
      { label: "Dân số quy hoạch", value: popV, unit: popU, note: "theo các đồ án đã duyệt" },
      { label: "Đường quy hoạch chung", value: fmt(K.road_km), unit: "km", note: `lộ giới <b>${fmt(K.road_reserve_ha)}</b> ha` },
      { label: "Thửa đất trong lộ giới", value: fmt(S.order.parcels_in_road), lvl: "warning", note: `<b>${fmt1(S.order.parcels_in_road_ha)}</b> ha có thể thu hồi` },
      { label: "Hồ sơ cấp phép công trình", value: fmt(projects.length), note: `<b>${gfaV}</b> ${gfaU} sàn` },
      { label: "Vốn đầu tư khai báo", value: fmt(cap / 1e9), unit: "tỷ đ", note: `${fmt(projects.filter((x) => x.capital).length)} hồ sơ có số liệu` },
      { label: "GPXD nhà ở riêng lẻ", value: fmt(K.house_permits), note: "phường Hiệp Bình (mới)" },
      { label: "Hồ sơ chưa hoàn chỉnh", value: fmt(issues), lvl: "warning", note: `<b>${pct(issues, projects.length)}</b> tổng hồ sơ` },
    ];
    $("#kpiTiles").innerHTML = tiles.map((t) => `
      <div class="tile"><div class="tile-label">${t.lvl ? statusIco(t.lvl) : ""}${esc(t.label)}</div>
      <div class="tile-value">${t.value}${t.unit ? `<span class="tile-unit">${esc(t.unit)}</span>` : ""}</div>
      <div class="tile-note">${t.note}</div></div>`).join("");

    // điểm nóng: số công trình có dấu hiệu theo phường (toàn khu vực, phường đang lọc được nhấn mạnh)
    const hot = [...countBy(S.order.sites.filter((s) => s.flags.length), (s) => s.ward)].sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));
    barH("chHot", hot, { unit: "công trình", highlight: state.ward, color: css("--series-2"), labelWidth: 110 });
  }

  // ------------------------------------------------------------------ map
  let map, baseLayer, mapLayers = {}, twin = {};
  // Nền bản đồ thành phố (HCMGIS), giữ nguyên màu; giao diện tối chỉ giảm độ sáng bằng CSS (.leaflet-tile-pane)
  const basemapUrl = () => "https://bando.tphcm.gov.vn/service/gisp/tile/HCMGIS/{z}/{x}/{y}";
  const ATTR = 'Bản đồ nền: <a href="https://bando.tphcm.gov.vn">bando.tphcm.gov.vn</a> · Dữ liệu: HCMGIS';

  const popup = (title, rows) => `<div class="pp-title">${esc(title)}</div>` +
    rows.filter((r) => r[1] != null && r[1] !== "").map((r) => `<div class="pp-row"><span>${esc(r[0])}</span><span>${esc(r[1])}</span></div>`).join("");

  function siteSeverity(flags) {
    for (const f of FLAG_ORDER) if (flags.includes(f)) return FLAG_SEVERITY[f];
    return null;
  }

  // Ba lĩnh vực dữ liệu theo cách phân nhóm của nguồn WFS (mã tài nguyên, đúng thứ tự trong nguồn)
  const DOMAINS = [
    { id: "dat_dai", name: "Dữ liệu đất đai", rids: [76, 78, 74, 147] },
    { id: "quy_hoach", name: "Dữ liệu quy hoạch", rids: [82, 80, 88, 90, 92, 84, 86, 94] },
    { id: "xay_dung", name: "Dữ liệu xây dựng", rids: [96, 98, 102, 100] },
  ];
  const domainOf = (rid) => DOMAINS.find((d) => d.rids.includes(rid));

  const LAYERS = [
    { id: "ranh_qh", name: "Ranh đồ án quy hoạch", on: true, kind: "poly",
      style: () => ({ color: css("--series-1"), weight: 1.5, fillOpacity: 0.04, fillColor: css("--series-1") }),
      popup: (p) => popup(p.ten, [["Quyết định", p.qd], ["Ngày duyệt", p.ngay], ["Cơ quan", p.cq], ["Diện tích", `${fmt1(p.ha)} ha`], ["Dân số QH", p.ds ? fmt(p.ds) : null]]) },
    { id: "sdd_qhc", name: "Sử dụng đất quy hoạch chung", on: false, kind: "poly", legend: "land",
      style: (f) => ({ color: css("--surface-1"), weight: 0.4, fillOpacity: 0.7, fillColor: LAND_COLORS[f.properties.nhom] || LAND_COLORS["Khác"] }),
      popup: (p) => popup(p.cn || "Ô đất", [["Nhóm", p.nhom], ["Ký hiệu", p.ma], ["Diện tích", `${fmt1(p.ha)} ha`]]) },
    { id: "hien_trang", name: "Hiện trạng sử dụng đất", on: false, kind: "poly", legend: "land",
      style: (f) => ({ color: css("--surface-1"), weight: 0.4, fillOpacity: 0.7, fillColor: LAND_COLORS[f.properties.nhom] || LAND_COLORS["Khác"] }),
      popup: (p) => popup(p.ten, [["Mã", p.ma], ["Nhóm", p.nhom], ["Diện tích", `${fmt1(p.ha)} ha`]]) },
    { id: "qh_sdd", name: "Quy hoạch sử dụng đất", on: false, kind: "poly", legend: "land",
      style: (f) => ({ color: css("--surface-1"), weight: 0.4, fillOpacity: 0.7, fillColor: LAND_COLORS[f.properties.nhom] || LAND_COLORS["Khác"] }),
      popup: (p) => popup(p.ten, [["Mã", p.ma], ["Nhóm", p.nhom], ["Diện tích", `${fmt1(p.ha)} ha`]]) },
    { id: "kh_sdd", name: "Kế hoạch sử dụng đất", on: false, kind: "poly",
      style: () => ({ color: css("--series-2"), weight: 2, fillOpacity: 0.15, fillColor: css("--series-2") }),
      popup: (p) => popup(p.ten || "Dự án", [["Loại đất KH", p.loai], ["Hiện trạng", p.ht], ["Diện tích", `${fmt1(p.ha)} ha`], ["Ghi chú", p.ghichu]]) },
    { id: "tim_duong", name: "Tim đường quy hoạch chung", on: true, kind: "line",
      style: (f) => ({ color: css("--text-secondary"), weight: f.properties.lg >= 30 ? 2.5 : f.properties.lg >= 20 ? 1.8 : 1, opacity: 0.7 }),
      popup: (p) => popup(p.ten || "Tuyến đường", [["Lộ giới", p.lg ? `${fmt1(p.lg)} m` : null], ["Chiều dài", `${fmt1(p.km)} km`], ["Trạng thái", p.tt]]) },
    { id: "thua", name: "Thửa đất địa chính", on: false, kind: "poly", ward: true,
      style: () => ({ color: css("--text-muted"), weight: 0.8, fillOpacity: 0.08 }),
      popup: (p) => popup(`Tờ ${p.to ?? "—"}, thửa ${p.thua ?? "—"}`, [["Phường", p.phuong], ["Diện tích", `${fmt(p.m2)} m²`], ["Đã có GCN", p.gcn ? "Có" : "Chưa có thông tin"]]) },
    { id: "gpxd", name: "Hồ sơ cấp phép xây dựng", on: true, kind: "point", ward: true,
      color: () => css("--series-1"),
      popup: (p) => popup(p.ten || p.loai, [["Mã hồ sơ", p.ma], ["Loại", p.loai], ["Năm", p.nam], ["Phường", p.phuong], ["Số tầng", p.tang], ["Diện tích sàn", p.san ? `${fmt(p.san)} m²` : null], ["Tình trạng hồ sơ", p.hoso]]) },
    { id: "ttxd", name: "Công trình theo dõi trật tự XD", on: true, kind: "point", ward: true, legend: "sites",
      color: (p) => { const s = siteSeverity(p.flags); return s ? css(SEVERITY[s].var) : css("--text-muted"); },
      popup: (p) => popup(`Công trình ${p.ma}`, [
        ["Phường (ước lượng)", p.phuong], ["Số tầng", p.tang], ["Chiều cao", p.cao ? `${fmt1(p.cao)} m` : null], ["Diện tích nền", `${fmt(p.m2)} m²`],
        ["Hồ sơ cấp phép", p.cp ? "Đối chiếu được" : "Chưa đối chiếu được"], ["Trong lộ giới", p.lgpct ? `${p.lgpct}% diện tích` : null],
        ["Chức năng theo QHC", p.qh], ["Tầng cao tối đa QHPK", p.tmax],
        ["Dấu hiệu", p.flags.length ? p.flags.map((f) => state.S.order.flag_labels[f]).join("; ") : "Không"],
      ]) },
  ];

  async function loadGeo(id) {
    if (!state.geo[id]) state.geo[id] = fetch(`data/geo/${id}.geojson`).then((r) => r.json());
    return state.geo[id];
  }

  function featureVisible(cfg, f) {
    const p = f.properties;
    if (cfg.ward && state.ward && p.phuong !== state.ward) return false;
    if (cfg.id === "ttxd" && state.flag && !p.flags.includes(state.flag)) return false;
    return true;
  }

  function buildLayer(cfg, gj, renderer) {
    const opts = { renderer, filter: (f) => featureVisible(cfg, f), onEachFeature: (f, l) => l.bindPopup(() => cfg.popup(f.properties), { maxWidth: 320 }) };
    if (cfg.kind === "point") {
      const surface = css("--surface-1");
      opts.pointToLayer = (f, ll) => {
        const m = L.circleMarker(ll, { renderer, radius: cfg.id === "ttxd" ? 5 : 4, weight: 2, color: surface, fillColor: cfg.color(f.properties), fillOpacity: 1 });
        if (cfg.id === "ttxd") state.siteMarkers.set(f.properties.i, m);
        return m;
      };
    } else {
      opts.style = cfg.style;
    }
    return L.geoJSON(gj, opts);
  }

  async function refreshLayer(cfg) {
    const old = mapLayers[cfg.id];
    if (old) map.removeLayer(old);
    delete mapLayers[cfg.id];
    const box = document.querySelector(`#layerList input[data-id="${cfg.id}"]`);
    if (!box || !box.checked) { renderMapLegend(); return; }
    const gj = await loadGeo(cfg.id);
    if (cfg.id === "ttxd") state.siteMarkers.clear();
    mapLayers[cfg.id] = buildLayer(cfg, gj, map._canvasRenderer).addTo(map);
    // giữ thứ tự: điểm luôn nằm trên đa giác
    ["gpxd", "ttxd"].forEach((k) => mapLayers[k] && mapLayers[k].bringToFront());
    renderMapLegend();
  }

  function renderLayerList() {
    const row = (c) => {
      const sw = c.kind === "point" ? `<span class="sw dot" style="background:var(${c.id === "ttxd" ? "--serious" : "--series-1"})"></span>`
        : c.kind === "line" ? `<span class="sw line" style="background:var(--text-secondary)"></span>`
        : c.legend === "land" ? `<span class="sw" style="background:linear-gradient(135deg,${LAND_COLORS["Nhà ở"]} 50%,${LAND_COLORS["Cây xanh – TDTT"]} 50%)"></span>`
        : `<span class="sw outline" style="border-color:var(${c.id === "kh_sdd" ? "--series-2" : c.id === "thua" ? "--text-muted" : "--series-1"})"></span>`;
      const n = (state.S.layers.find((l) => l.keyname && layerKeyMatch(l, c.id)) || {}).count;
      return `<label><input type="checkbox" data-id="${c.id}" ${c.on ? "checked" : ""}>${sw}${esc(c.name)}<span class="cnt">${n != null ? fmt(n) : ""}</span></label>`;
    };
    $("#layerList").innerHTML = DOMAINS.map((d) => {
      const ls = LAYERS.filter((c) => domainOf(LAYER_RID[c.id]) === d)
        .sort((a, b) => d.rids.indexOf(LAYER_RID[a.id]) - d.rids.indexOf(LAYER_RID[b.id]));
      return ls.length ? `<div class="layer-group">${esc(d.name)}</div>` + ls.map(row).join("") : "";
    }).join("");
  }
  function bindLayerList() {
    $("#layerList").addEventListener("change", (e) => {
      const cfg = LAYERS.find((c) => c.id === e.target.dataset.id);
      // các lớp sử dụng đất chồng nhau — chỉ bật một lớp mỗi lúc
      if (e.target.checked && cfg.legend === "land") {
        LAYERS.filter((c) => c.legend === "land" && c !== cfg).forEach((c) => {
          const b = document.querySelector(`#layerList input[data-id="${c.id}"]`);
          if (b.checked) { b.checked = false; refreshLayer(c); }
        });
      }
      refreshLayer(cfg);
    });
  }
  const LAYER_RID = { ranh_qh: 80, sdd_qhc: 82, hien_trang: 76, qh_sdd: 74, kh_sdd: 78, tim_duong: 84, thua: 147, gpxd: 102, ttxd: 100 };
  const layerKeyMatch = (l, id) => l.id === LAYER_RID[id];

  function landLegendHtml(groups, title) {
    return `<div><div class="legend-title">${esc(title)}</div><ul class="legend">` +
      groups.map((g) => `<li><span class="sw" style="background:${LAND_COLORS[g] || LAND_COLORS["Khác"]}"></span>${esc(g)}</li>`).join("") + "</ul></div>";
  }
  function sitesLegendHtml() {
    const rows = FLAG_ORDER.filter((f, i, a) => a.findIndex((x) => FLAG_SEVERITY[x] === FLAG_SEVERITY[f]) === i)
      .map((f) => { const s = SEVERITY[FLAG_SEVERITY[f]]; return `<li><span class="sw dot" style="background:var(${s.var})"></span>${s.icon} ${s.label}</li>`; });
    rows.push(`<li><span class="sw dot" style="background:var(--text-muted)"></span>Không có dấu hiệu</li>`);
    return `<div><div class="legend-title">Công trình trật tự XD</div><ul class="legend">${rows.join("")}</ul></div>`;
  }
  async function renderMapLegend() {
    let html = "";
    const landOn = LAYERS.find((c) => c.legend === "land" && mapLayers[c.id]);
    if (landOn) {
      const gj = await loadGeo(landOn.id);
      const groups = [...new Set(gj.features.map((f) => f.properties.nhom))].sort((a, b) => Object.keys(LAND_COLORS).indexOf(a) - Object.keys(LAND_COLORS).indexOf(b));
      html += landLegendHtml(groups, landOn.name);
    }
    if (mapLayers.ttxd) html += sitesLegendHtml();
    $("#mapLegend").innerHTML = html;
  }

  // Leaflet cần biết kích thước thật của khung sau khi lưới CSS co giãn xong
  function watchSize(m) {
    let first = true;
    new ResizeObserver(() => {
      m.invalidateSize();
      if (first && m === map) m.fitBounds(state.S.bounds);
      first = false;
    }).observe(m.getContainer());
  }

  function initMap() {
    const S = state.S;
    map = L.map("mainMap", { preferCanvas: true, zoomControl: true, zoomSnap: 0.25 }).fitBounds(S.bounds);
    watchSize(map);
    map._canvasRenderer = L.canvas({ padding: 0.5, tolerance: 4 });
    baseLayer = L.tileLayer(basemapUrl(), { attribution: ATTR, maxZoom: 19 }).addTo(map);
    renderLayerList();
    bindLayerList();
    LAYERS.forEach(refreshLayer);
    map.on("moveend", syncFullMapLink);
    syncFullMapLink();
  }

  /* Trang bản đồ chia sẻ NextGIS (webmap 222, đủ 16 lớp): mở đúng vùng đang xem. */
  const FULL_MAP_URL = "https://nextgis.hcmgis.vn/resource/222/display";
  function syncFullMapLink() {
    const c = map.getCenter();
    const q = new URLSearchParams({ panel: "layers", lon: c.lng.toFixed(6), lat: c.lat.toFixed(6), zoom: Math.round(map.getZoom()) });
    $("#openFullMap").href = `${FULL_MAP_URL}?${q}`;
  }

  async function initTwinMaps() {
    const S = state.S;
    const mk = (id) => {
      const m = L.map(id, { preferCanvas: true, attributionControl: id === "mapQH", zoomSnap: 0.25 }).fitBounds(S.bounds);
      watchSize(m);
      m._tile = L.tileLayer(basemapUrl(), { attribution: ATTR, maxZoom: 19 }).addTo(m);
      return m;
    };
    twin.ht = mk("mapHT"); twin.qh = mk("mapQH");
    let syncing = false;
    const sync = (a, b) => a.on("move", () => { if (syncing) return; syncing = true; b.setView(a.getCenter(), a.getZoom(), { animate: false }); syncing = false; });
    sync(twin.ht, twin.qh); sync(twin.qh, twin.ht);
    const [ht, qh] = await Promise.all([loadGeo("hien_trang"), loadGeo("qh_sdd")]);
    const r1 = L.canvas(), r2 = L.canvas();
    const cfgHT = LAYERS.find((c) => c.id === "hien_trang"), cfgQH = LAYERS.find((c) => c.id === "qh_sdd");
    twin.htLayer = buildLayer(cfgHT, ht, r1).addTo(twin.ht);
    twin.qhLayer = buildLayer(cfgQH, qh, r2).addTo(twin.qh);
    twin.ht.invalidateSize(); twin.qh.invalidateSize();
    twin.ht.fitBounds(twin.htLayer.getBounds().extend(twin.qhLayer.getBounds()));
    const groups = [...new Set([...ht.features, ...qh.features].map((f) => f.properties.nhom))]
      .sort((a, b) => Object.keys(LAND_COLORS).indexOf(a) - Object.keys(LAND_COLORS).indexOf(b));
    $("#landLegend").innerHTML = landLegendHtml(groups, "Nhóm loại đất (theo mã loại đất)");
  }

  // ------------------------------------------------------------------ sections
  function renderPlanning() {
    const S = state.S, P = S.planning;
    const plans = P.plans.filter(inWard);
    const years = countBy(plans, (x) => x.year);
    const allYears = P.by_year.map((d) => +d.label);
    const ys = [];
    for (let y = Math.min(...allYears); y <= Math.max(...allYears); y++) ys.push({ label: String(y), value: years.get(y) || 0 });
    column("chPlanYear", ys, { unit: "đồ án" });
    barH("chQhcMix", P.qhc_mix.map((d) => ({ label: d.label, value: d.ha })), { unit: "ha", labelWidth: 160 });
    const appr = [...countBy(plans, (x) => x.approver)].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
    barH("chApprover", appr, { unit: "đồ án", labelWidth: 200 });
    barH("chRoads", S.roads.qhc.by_logioi, { unit: "km", digits: 1 });
    const area = plans.reduce((a, x) => a + x.area_ha, 0), pop = plans.reduce((a, x) => a + (x.pop_plan || 0), 0);
    const peak = ys.reduce((a, d) => (d.value > a.value ? d : a), { value: -1 });
    const [popV, popU] = bigNum(pop, "dân");
    renderStats("#planStats", [
      { v: fmt(plans.length), l: "đồ án đã duyệt", key: true },
      { v: fmt(area), u: "ha", l: "diện tích quy hoạch" },
      { v: popV, u: popU, l: "dân số dự kiến" },
      { v: peak.value > 0 ? peak.label : "—", u: peak.value > 0 ? `${peak.value} đồ án` : "", l: "năm duyệt nhiều nhất" },
      { v: fmt1(S.roads.qhc.total_km), u: "km", l: "đường quy hoạch chung" },
    ]);
    const top = plans.slice().sort((a, b) => b.area_ha - a.area_ha).slice(0, 10);
    $("#tblPlans").innerHTML = `<thead><tr><th>Đồ án</th><th>Quyết định</th><th>Cơ quan duyệt</th><th class="num">Năm</th><th class="num">Diện tích (ha)</th><th class="num">Dân số QH</th></tr></thead><tbody>` +
      top.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.decision || "—")}</td><td>${esc(x.approver || "—")}</td><td class="num">${x.year ?? "—"}</td><td class="num">${fmt1(x.area_ha)}</td><td class="num">${x.pop_plan ? fmt(x.pop_plan) : "—"}</td></tr>`).join("") +
      (top.length ? "" : `<tr><td colspan="6" class="muted">Không có đồ án nào trong phường đã chọn</td></tr>`) + "</tbody>";
  }

  function renderConstruction() {
    const S = state.S, C = S.construction;
    const all = C.projects, projects = all.filter(inWard);
    const byWard = [...countBy(all, (x) => x.ward)].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
    barH("chPermitWard", byWard, { unit: "hồ sơ", highlight: state.ward });
    const years = countBy(projects, (x) => x.year);
    const ys = C.by_year.map((d) => ({ label: d.label, value: years.get(+d.label) || 0 }));
    column("chPermitYear", ys, { unit: "hồ sơ" });
    const kinds = [...countBy(projects, (x) => x.kind)].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
    barH("chPermitKind", kinds, { unit: "hồ sơ" });

    const bins = [["1–3 tầng", 1, 3], ["4–9 tầng", 4, 9], ["10–19 tầng", 10, 19], ["≥ 20 tầng", 20, 999]];
    const hist = (arr) => bins.map(([, lo, hi]) => arr.filter((v) => v >= lo && v <= hi).length);
    const fh = hist(projects.map((x) => x.floors || 0));
    barH("chPermitFloors", bins.map((b, i) => ({ label: b[0], value: fh[i] })), { unit: "hồ sơ", labelWidth: 80 });

    const shown = new Map();
    const issues = countBy(projects.filter((x) => x.issue), (x) => {
      const k = x.issue.toLowerCase().replace(/\s+/g, " ");
      if (!shown.has(k)) shown.set(k, x.issue.replace(/\s+/g, " "));
      return k;
    });
    $("#dossierIssues").innerHTML = [...issues].sort((a, b) => b[1] - a[1]).map(([k, v]) => { const t = shown.get(k); return `<li><span>${esc(t[0].toUpperCase() + t.slice(1))}</span><span>${v}</span></li>`; }).join("") ||
      `<li class="muted">Không có hồ sơ chưa hoàn chỉnh</li>`;

    barH("chSonha", S.land.sonha_by_ward, { unit: "số nhà", highlight: state.ward });

    const gfa = projects.reduce((a, x) => a + (x.gfa || 0), 0);
    const cap = projects.reduce((a, x) => a + (x.capital || 0), 0);
    const yrs = projects.map((x) => x.year).filter(Boolean);
    const [gfaV, gfaU] = bigNum(gfa, "m²");
    renderStats("#permitStats", [
      { v: fmt(projects.length), u: yrs.length ? `${Math.min(...yrs)}–${Math.max(...yrs)}` : "", l: "hồ sơ công trình, dự án", key: true },
      { v: gfaV, u: gfaU, l: "tổng diện tích sàn" },
      { v: fmt(cap / 1e9), u: "tỷ đ", l: "vốn đầu tư khai báo" },
      { v: fmt(S.kpi.house_permits), l: "GPXD nhà ở riêng lẻ" },
      { v: fmt(S.kpi.sonha), l: "số nhà được cấp" },
    ]);

    const top = projects.filter((x) => x.gfa).sort((a, b) => b.gfa - a.gfa).slice(0, 10);
    $("#tblTopGfa").innerHTML = `<thead><tr><th>Công trình</th><th>Mã hồ sơ</th><th>Phường</th><th class="num">Số tầng</th><th class="num">Diện tích sàn (m²)</th><th class="num">Vốn (tỷ đồng)</th></tr></thead><tbody>` +
      top.map((x) => `<tr><td>${esc(x.name || "—")}</td><td>${esc(x.code)}</td><td>${esc(x.ward || "—")}</td><td class="num">${x.floors ?? "—"}</td><td class="num">${fmt(x.gfa)}</td><td class="num">${x.capital ? fmt(x.capital / 1e9) : "—"}</td></tr>`).join("") + "</tbody>";
  }

  function renderOrder() {
    const S = state.S, O = S.order;
    const sites = O.sites.filter(inWard);
    const fc = FLAG_ORDER.map((k) => ({ label: shortFlag(k), value: sites.filter((s) => s.flags.includes(k)).length }));
    barH("chFlags", fc, { unit: "công trình", labelWidth: 140 });
    const wardsSorted = [...countBy(O.sites, (s) => s.ward)].sort((a, b) => b[1] - a[1]).map(([w]) => w);
    const flaggedBy = countBy(O.sites.filter((s) => s.flags.length), (s) => s.ward);
    const allBy = countBy(O.sites, (s) => s.ward);
    multiBarH("chOrderWard", wardsSorted, [
      { name: "Có dấu hiệu cần kiểm tra", values: wardsSorted.map((w) => flaggedBy.get(w) || 0), color: css("--series-2") },
      { name: "Không có dấu hiệu", values: wardsSorted.map((w) => (allBy.get(w) || 0) - (flaggedBy.get(w) || 0)), color: css("--series-1") },
    ], { stacked: true, unit: "công trình", legendEl: $("#lgOrderWard") });
    if (state.ward) {
      const c = state.charts.chOrderWard;
      c.dispatchAction({ type: "highlight", seriesIndex: [0, 1], dataIndex: wardsSorted.slice().reverse().indexOf(state.ward) });
    }
    const flagged = sites.filter((s) => s.flags.length);
    const linked = sites.filter((s) => s.linked).length;
    renderStats("#orderStats", [
      { v: fmt(flagged.length), u: `/ ${fmt(sites.length)}`, l: "công trình có dấu hiệu", key: true },
      { v: pct(linked, sites.length), u: `${fmt(linked)} ct`, l: "khớp được hồ sơ cấp phép" },
      ...FLAG_ORDER.map((k) => ({ v: fmt(sites.filter((s) => s.flags.includes(k)).length), l: shortFlag(k), lvl: FLAG_SEVERITY[k] })),
    ]);

    $("#flagChips").innerHTML = [["", "Tất cả có dấu hiệu"], ...FLAG_ORDER.map((k) => [k, O.flag_labels[k]])]
      .map(([k, l]) => `<button class="chip" type="button" data-flag="${k}" aria-pressed="${state.flag === k}">${esc(l)}</button>`).join("");
    const rows = sites.filter((s) => (state.flag ? s.flags.includes(state.flag) : s.flags.length))
      .sort((a, b) => sevRank(a.flags) - sevRank(b.flags) || b.floors - a.floors);
    $("#tblSites").innerHTML = `<thead><tr><th>Mã công trình</th><th>Phường (ước lượng)</th><th class="num">Số tầng</th><th class="num">Diện tích nền (m²)</th><th>Hồ sơ cấp phép</th><th class="num">Trong lộ giới</th><th>Chức năng theo QHC</th><th>Dấu hiệu</th></tr></thead><tbody>` +
      rows.map((s) => `<tr class="clickable" data-i="${s.i}"><td>${esc(s.code)}</td><td>${esc(s.ward || "—")}</td><td class="num">${s.floors}${s.max_floor ? ` / tối đa ${s.max_floor}` : ""}</td><td class="num">${fmt(s.area)}</td>
        <td>${s.linked ? "Đối chiếu được" : "Chưa đối chiếu được"}</td><td class="num">${s.enc ? Math.round(s.enc * 100) + "%" : "—"}</td><td>${esc(s.qh_func || "—")}</td>
        <td>${s.flags.map((f) => { const sv = SEVERITY[FLAG_SEVERITY[f]]; return `<span class="tag"><span class="sw" style="background:var(${sv.var})"></span>${esc(shortFlag(f))}</span>`; }).join("")}</td></tr>`).join("") +
      (rows.length ? "" : `<tr><td colspan="8" class="muted">Không có công trình phù hợp bộ lọc</td></tr>`) + "</tbody>";
    $("#cntSites").textContent = fmt(rows.length);
  }
  const sevRank = (flags) => { const s = siteSeverity(flags); return s === "critical" ? 0 : s === "serious" ? 1 : s === "warning" ? 2 : 3; };
  const shortFlag = (f) => ({ road: "Lấn lộ giới", no_permit: "Chưa khớp giấy phép", landuse: "Sai chức năng QH", height: "Vượt tầng cao" }[f]);

  function renderLand() {
    const S = state.S, Ld = S.land;
    multiBarH("chLandCompare", Ld.compare.map((d) => d.label), [
      { name: `Hiện trạng (${fmt(Ld.ht_total_ha)} ha)`, values: Ld.compare.map((d) => d.ht_pct), color: css("--series-1") },
      { name: `Quy hoạch (${fmt(Ld.qh_total_ha)} ha)`, values: Ld.compare.map((d) => d.qh_pct), color: css("--series-2") },
    ], { unit: "%", digits: 1, legendEl: $("#lgLandCompare"), labelWidth: 160 });
    const kh = Ld.kh_items.filter(inWard);
    const byType = new Map(); kh.forEach((x) => byType.set(x.type || "Chưa có thông tin", (byType.get(x.type || "Chưa có thông tin") || 0) + x.area_ha));
    barH("chKh", [...byType].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value: Math.round(value * 10) / 10 })), { unit: "ha", digits: 1, labelWidth: 190 });
    // hai thay đổi cơ cấu lớn nhất (điểm %), hiện trạng → quy hoạch
    const shifts = Ld.compare.map((d) => ({ ...d, d: d.qh_pct - d.ht_pct })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2);
    renderStats("#landStats", [
      { v: fmt(Ld.ht_total_ha), u: "ha", l: "hiện trạng sử dụng đất" },
      { v: fmt(Ld.qh_total_ha), u: "ha", l: "quy hoạch sử dụng đất" },
      ...shifts.map((s) => ({ v: `${fmt1(s.ht_pct)} → ${fmt1(s.qh_pct)}`, u: "%", l: `${s.label} (hiện trạng → quy hoạch)`, key: true })),
      { v: fmt(kh.length), u: `${fmt1(kh.reduce((a, x) => a + x.area_ha, 0))} ha`, l: "dự án kế hoạch SDĐ" },
    ]);
    $("#cntKh").textContent = fmt(kh.length);
    $("#tblKh").innerHTML = `<thead><tr><th>Công trình, dự án</th><th>Loại đất kế hoạch</th><th>Hiện trạng</th><th>Phường (ước lượng)</th><th class="num">Diện tích (ha)</th><th>Ghi chú</th></tr></thead><tbody>` +
      kh.map((x) => `<tr><td>${esc(x.name || "—")}</td><td>${esc(x.type || "—")}</td><td>${esc(x.current || "—")}</td><td>${esc(x.ward || "—")}</td><td class="num">${fmt1(x.area_ha)}</td><td>${esc(x.note || "")}</td></tr>`).join("") + "</tbody>";
  }

  function renderDq() {
    const S = state.S;
    $("#cntDq").textContent = fmt(S.data_quality.length);
    $("#tblDq").innerHTML = `<thead><tr><th>Lớp dữ liệu</th><th>Vấn đề</th><th>Cách xử lý trên dashboard</th></tr></thead><tbody>` +
      S.data_quality.map((d) => `<tr><td>${esc(d.layer)}</td><td>${esc(d.issue)}</td><td>${esc(d.impact)}</td></tr>`).join("") + "</tbody>";
    const byId = new Map(S.layers.map((l) => [l.id, l]));
    $("#tblLayers").innerHTML = `<thead><tr><th>Lĩnh vực</th><th>Mã tài nguyên</th><th>Lớp</th><th class="num">Số đối tượng</th></tr></thead><tbody>` +
      DOMAINS.map((d) => d.rids.filter((r) => byId.has(r)).map((r, i, a) => { const l = byId.get(r);
        return `<tr>${i ? "" : `<td rowspan="${a.length}">${esc(d.name)}</td>`}<td>${l.id}</td><td>${esc(l.name)}</td><td class="num">${fmt(l.count)}</td></tr>`; }).join("")).join("") +
      S.layers.filter((l) => !domainOf(l.id)).map((l) => `<tr><td>—</td><td>${l.id}</td><td>${esc(l.name)}</td><td class="num">${fmt(l.count)}</td></tr>`).join("") + "</tbody>";
  }

  // ------------------------------------------------------------------ interactions
  function setFlag(f) {
    state.flag = f;
    renderOrder();
    document.querySelectorAll("#flagRows [data-filter]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.filter === f));
    const pill = $("#mapFilter");
    pill.hidden = !f;
    if (f) pill.innerHTML = `Đang lọc: ${esc(shortFlag(f))}<button type="button" aria-label="Bỏ lọc">✕</button>`;
    refreshLayer(LAYERS.find((c) => c.id === "ttxd"));
  }

  async function setWard(w) {
    state.ward = w;
    renderAll();
    for (const c of LAYERS.filter((x) => x.ward)) await refreshLayer(c);
    if (w) {
      const gj = await loadGeo("ttxd");
      const pts = gj.features.filter((f) => f.properties.phuong === w).map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
      if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
    } else {
      map.fitBounds(state.S.bounds);
    }
  }

  function renderAll() {
    renderTiles(); renderLand(); renderPlanning(); renderConstruction(); renderOrder();
  }

  function onThemeChange() {
    renderAll();
    [baseLayer, twin.ht && twin.ht._tile, twin.qh && twin.qh._tile].forEach((t) => t && t.setUrl(basemapUrl()));
    LAYERS.forEach(refreshLayer);
    if (twin.htLayer) twin.htLayer.setStyle(LAYERS.find((c) => c.id === "hien_trang").style);
    if (twin.qhLayer) twin.qhLayer.setStyle(LAYERS.find((c) => c.id === "qh_sdd").style);
  }

  function bindEvents() {
    $("#wardFilter").addEventListener("change", (e) => setWard(e.target.value));
    $("#themeToggle").addEventListener("click", toggleTheme);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!document.documentElement.dataset.theme) onThemeChange(); });
    $("#flagChips").addEventListener("click", (e) => { const b = e.target.closest("[data-flag]"); if (b) setFlag(b.dataset.flag); });
    $("#flagRows").addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]"); if (!b) return;
      setFlag(state.flag === b.dataset.filter ? "" : b.dataset.filter);
      $("#mainMap").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    $("#mapFilter").addEventListener("click", (e) => { if (e.target.closest("button")) setFlag(""); });
    $("#tblSites").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-i]"); if (!tr) return;
      const m = state.siteMarkers.get(+tr.dataset.i);
      $("#mainMap").scrollIntoView({ behavior: "smooth", block: "center" });
      if (m) { map.setView(m.getLatLng(), 18); setTimeout(() => m.openPopup(), 350); }
    });
    document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => {
      $("#sitesFold").open = true;
      document.getElementById(b.dataset.goto).scrollIntoView({ behavior: "smooth" });
    }));
    window.addEventListener("resize", () => Object.values(state.charts).forEach((c) => c.resize()));
    // tab đang xem
    const links = [...document.querySelectorAll(".tabs a")];
    const io = new IntersectionObserver((es) => es.forEach((en) => {
      if (en.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${en.target.id}`));
    }), { rootMargin: "-40% 0px -55% 0px" });
    document.querySelectorAll("main > section").forEach((s) => io.observe(s));
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    applyStoredTheme();
    try {
      state.S = await fetch("data/summary.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    } catch (err) {
      document.querySelector("main").innerHTML = `<div class="card"><h2>Chưa có dữ liệu</h2><p>Không đọc được <code>data/summary.json</code> (${esc(err.message)}). Chạy <code>etl/fetch.py</code> và <code>etl/build.py</code>, rồi mở trang qua máy chủ web (xem README).</p></div>`;
      return;
    }
    renderHeader();
    renderAll();
    renderDq();
    initMap();
    initTwinMaps();
    bindEvents();
  }
  boot();
})();
