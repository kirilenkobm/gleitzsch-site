// Production Pixelate D. Reuse reduction scratch between the three weighted
// means: identical balanced additions, 13 KiB workgroup storage (WebGPU minimum).
struct Cell { base: vec4<f32>, dark: vec4<f32>, bright: vec4<f32>, feature: vec4<f32> }
struct Grid { width: u32, height: u32, size: u32, columns: u32 }
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> lab: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> smoothed: array<f32>;
@group(0) @binding(3) var<storage, read_write> gradient: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> ridges: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(6) var<storage, read_write> threshold: array<f32>;
@group(0) @binding(7) var<storage, read_write> candidates: array<u32>;
@group(0) @binding(8) var<storage, read_write> supported: array<u32>;
@group(0) @binding(9) var<storage, read_write> colors: array<u32>;
@group(0) @binding(10) var<storage, read> tables: array<u32>;
@group(0) @binding(11) var<uniform> grid: Grid;
@group(0) @binding(12) var result: texture_storage_2d<rgba8unorm, write>;
fn offset(p: vec2<u32>) -> u32 { return p.y * grid.width + p.x; }
fn bounded(p: vec2<i32>) -> vec2<u32> { return vec2<u32>(clamp(p, vec2<i32>(0), vec2<i32>(i32(grid.width) - 1, i32(grid.height) - 1))); }
fn dimensions() -> vec2<u32> { return vec2<u32>(grid.columns, (grid.height + grid.size - 1u) / grid.size); }
fn cellAt(p: vec2<i32>) -> u32 { let q = vec2<u32>(clamp(p, vec2<i32>(0), vec2<i32>(dimensions()) - vec2<i32>(1))); return q.y * grid.columns + q.x; }
fn tableFloat(byte: u32) -> f32 { return bitcast<f32>(tables[byte / 4u]); }
fn tableByte(byte: u32) -> u32 { return (tables[byte / 4u] >> ((byte % 4u) * 8u)) & 255u; }
fn palette(index: u32) -> vec3<f32> {
  let p = 1040u + index * 16u; return vec3<f32>(tableFloat(p), tableFloat(p + 4u), tableFloat(p + 8u));
}
fn tone(v: vec3<f32>) -> vec3<f32> {
  var t = clamp((v.x - 0.50) / 0.25, 0.0, 1.0); t = t * t * (3.0 - 2.0 * t);
  return vec3<f32>(clamp(v.x + 0.18 * pow(1.0 - v.x, 3.0) + 0.16 * (v.x - 0.80) * t, 0.0, 0.98), v.yz * 1.20);
}
fn toLab(rgb: vec3<f32>) -> vec3<f32> {
  let b = vec3<u32>(round(rgb * 255.0));
  let c = vec3<f32>(tableFloat(16u + b.r * 4u), tableFloat(16u + b.g * 4u), tableFloat(16u + b.b * 4u));
  let l = dot(c, vec3<f32>(0.4122214708, 0.5363325363, 0.0514459929));
  let m = dot(c, vec3<f32>(0.2119034982, 0.6806995451, 0.1073969566));
  let s = dot(c, vec3<f32>(0.0883024619, 0.2817188376, 0.6299787005));
  let v = pow(max(vec3<f32>(l, m, s), vec3<f32>(0)), vec3<f32>(1.0 / 3.0));
  return vec3<f32>(dot(v, vec3<f32>(0.2104542553, 0.7936177850, -0.0040720468)),
    dot(v, vec3<f32>(1.9779984951, -2.4285922050, 0.4505937099)), dot(v, vec3<f32>(0.0259040371, 0.7827717662, -0.8086757660)));
}
fn toRgb(v: vec3<f32>) -> vec3<f32> {
  var c = vec3<f32>(v.x + 0.3963377774 * v.y + 0.2158037573 * v.z,
    v.x - 0.1055613458 * v.y - 0.0638541728 * v.z, v.x - 0.0894841775 * v.y - 1.2914855480 * v.z);
  c = c * c * c;
  let rgb = clamp(vec3<f32>(dot(c, vec3<f32>(4.0767416621, -3.3077115913, 0.2309699292)),
    dot(c, vec3<f32>(-1.2684380046, 2.6097574011, -0.3413193965)), dot(c, vec3<f32>(-0.0041960362, -0.7034186147, 1.7076147010))), vec3<f32>(0), vec3<f32>(1));
  return select(1.055 * pow(rgb, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055), 12.92 * rgb, rgb <= vec3<f32>(0.0031308));
}
@compute @workgroup_size(16, 16)
fn color(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= grid.width || id.y >= grid.height) { return; }
  let v = toLab(textureLoad(image, id.xy, 0).rgb); var lift = v;
  var t = clamp((v.x - 0.5) / 0.5, 0.0, 1.0); t = t * t * (3.0 - 2.0 * t);
  lift.x = clamp(v.x + 0.55 * t * (1.0 - v.x), 0.0, 1.0); lift = vec3<f32>(lift.x, lift.yz * 1.30);
  let q = vec3<u32>(clamp(round(round(toRgb(lift) * 255.0) * (47.0 / 255.0)), vec3<f32>(0), vec3<f32>(47)));
  lab[offset(id.xy)] = vec4<f32>(v, f32(tableByte(6160u + (q.r * 48u + q.g) * 48u + q.b)));
}
@compute @workgroup_size(16, 16)
fn geometry(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= grid.width || id.y >= grid.height) { return; }
  var gx = vec3<f32>(0); var gy = vec3<f32>(0); var l = 0.0;
  for (var dy = -1; dy <= 1; dy++) { for (var dx = -1; dx <= 1; dx++) {
    let v = lab[offset(bounded(vec2<i32>(id.xy) + vec2<i32>(dx, dy)))].xyz;
    l += v.x; gx += v * f32(dx * select(3, 10, dy == 0)); gy += v * f32(dy * select(3, 10, dx == 0));
  } }
  gx /= 32.0; gy /= 32.0; let energy = gx * gx + gy * gy;
  var channel = select(0u, 1u, energy.y > energy.x); if (energy.z > energy[channel]) { channel = 2u; }
  let angle = atan2(gy[channel], gx[channel]) * 180.0 / 3.14159265358979323846;
  let sector = floor(((angle + 202.5) % 180.0) / 45.0);
  smoothed[offset(id.xy)] = l / 9.0; gradient[offset(id.xy)] = vec2<f32>(sqrt(energy.x + energy.y + energy.z), sector);
}
@compute @workgroup_size(16, 16)
fn ridge(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= grid.width || id.y >= grid.height) { return; }
  let dirs = array<vec2<i32>, 4>(vec2<i32>(0, 1), vec2<i32>(1, 0), vec2<i32>(1, 1), vec2<i32>(1, -1));
  var best = vec2<f32>(0);
  for (var r = 0u; r < 2u; r++) { for (var direction = 0u; direction < 4u; direction++) {
    let radius = max(1, i32(floor(f32(grid.size * select(6u, 3u, r == 0u)) / 16.0 + 0.5)));
    let d = dirs[direction]; let normal = d * radius; var center = vec2<f32>(0); var support = vec2<u32>(0);
    for (var t = -2; t <= 2; t++) {
      let q = bounded(vec2<i32>(id.xy) + vec2<i32>(-d.y, d.x) * t);
      let c = smoothed[offset(q)]; let a = smoothed[offset(bounded(vec2<i32>(q) + normal))]; let b = smoothed[offset(bounded(vec2<i32>(q) - normal))];
      let response = vec2<f32>(min(a, b) - c, c - max(a, b));
      support += select(vec2<u32>(0), vec2<u32>(1), response > vec2<f32>(0.045, 0.055)); if (t == 0) { center = response; }
    }
    let valid = vec2<bool>(support.x >= 3u && center.x > 0.045, support.y >= 3u && center.y > 0.055);
    best = max(best, select(vec2<f32>(0), center, valid));
  } }
  ridges[offset(id.xy)] = best;
}

var<workgroup> histogram: array<atomic<u32>, 256>;
var<workgroup> votes: array<u32, 256>;
var<workgroup> sums: array<vec4<f32>, 256>;
var<workgroup> grads: array<vec4<f32>, 256>;
var<workgroup> levels: array<vec2<f32>, 256>;
var<workgroup> edgeIndices: array<u32, 256>;
@compute @workgroup_size(256)
fn cell(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_index) lane: u32) {
  let side = min(grid.size, 16u); let samples = side * side; let sampleActive = lane < samples;
  let local = vec2<u32>((vec2<f32>(f32(lane % side), f32(lane / side)) + vec2<f32>(0.5)) * f32(grid.size) / f32(side));
  let pos = min(group.xy * grid.size + local, vec2<u32>(grid.width - 1u, grid.height - 1u));
  let v = lab[offset(pos)]; let r = ridges[offset(pos)]; let g = gradient[offset(pos)];
  let index = group.y * grid.columns + group.x;
  atomicStore(&histogram[lane], 0u); workgroupBarrier();
  if (sampleActive) { atomicAdd(&histogram[u32(v.w)], 1u); } workgroupBarrier();
  votes[lane] = (atomicLoad(&histogram[lane]) << 8u) + (255u - lane);
  for (var step = 128u; step > 0u; step >>= 1u) { workgroupBarrier(); if (lane < step) { votes[lane] = max(votes[lane], votes[lane + step]); } }
  workgroupBarrier(); let winner = 255u - (votes[0] & 255u);
  sums[lane] = select(vec4<f32>(0), vec4<f32>(v.xyz, 1), sampleActive && u32(v.w) == winner);
  grads[lane] = select(vec4<f32>(0), vec4<f32>(g, select(0.0, 1.0, r.x > 0), select(0.0, 1.0, r.y > 0)), sampleActive);
  levels[lane] = select(vec2<f32>(0), r, sampleActive); edgeIndices[lane] = lane;
  for (var step = 128u; step > 0u; step >>= 1u) {
    workgroupBarrier(); if (lane < step) {
      sums[lane] += sums[lane + step]; let b = grads[lane + step];
      if (b.x > grads[lane].x || (b.x == grads[lane].x && edgeIndices[lane + step] < edgeIndices[lane])) {
        grads[lane] = vec4<f32>(b.xy, grads[lane].zw); edgeIndices[lane] = edgeIndices[lane + step];
      }
      grads[lane] = vec4<f32>(grads[lane].xy, grads[lane].zw + b.zw);
    }
  }
  workgroupBarrier(); if (lane == 0u) { cells[index].base = vec4<f32>(tone(sums[0].xyz / sums[0].w), 0); }
  workgroupBarrier(); sums[lane] = select(vec4<f32>(0), vec4<f32>(v.xyz * r.x, r.x), sampleActive);
  for (var step = 128u; step > 0u; step >>= 1u) { workgroupBarrier(); if (lane < step) { sums[lane] += sums[lane + step]; } }
  workgroupBarrier(); if (lane == 0u) { cells[index].dark = vec4<f32>(sums[0].xyz / max(sums[0].w, 1e-9), grads[0].z / f32(samples)); }
  workgroupBarrier(); sums[lane] = select(vec4<f32>(0), vec4<f32>(v.xyz * r.y, r.y), sampleActive);
  for (var step = 128u; step > 0u; step >>= 1u) { workgroupBarrier(); if (lane < step) { sums[lane] += sums[lane + step]; } }
  workgroupBarrier(); if (lane == 0u) { cells[index].bright = vec4<f32>(sums[0].xyz / max(sums[0].w, 1e-9), grads[0].w / f32(samples)); }
  for (var size = 2u; size <= 256u; size <<= 1u) { for (var step = size >> 1u; step > 0u; step >>= 1u) {
    workgroupBarrier(); let a = levels[lane]; let b = levels[lane ^ step];
    let small = ((lane & size) == 0u) == ((lane & step) == 0u);
    let value = select(max(a, b), min(a, b), small); workgroupBarrier(); levels[lane] = value;
  } }
  workgroupBarrier(); if (lane == 0u) {
    let top = max(1u, (samples * 12u + 255u) / 256u); var peak = vec2<f32>(0);
    for (var i = 256u - top; i < 256u; i++) { peak += levels[i]; }
    cells[index].feature = vec4<f32>(peak / f32(top), grads[0].xy);
  }
}
// Exact radix order statistics for every grid size; no approximate percentile.
var<workgroup> bins: array<atomic<u32>, 512>;
var<workgroup> prefixes: array<u32, 2>;
var<workgroup> ranks: array<u32, 2>;
@compute @workgroup_size(256)
fn percentile(@builtin(local_invocation_index) lane: u32) {
  let count = dimensions().x * dimensions().y; let rank = f32(count - 1u) * 0.9;
  if (lane == 0u) { prefixes[0] = 0u; prefixes[1] = 0u; ranks[0] = u32(rank); ranks[1] = min(count - 1u, u32(rank) + 1u); }
  workgroupBarrier();
  for (var shift = 24; shift >= 0; shift -= 8) {
    atomicStore(&bins[lane], 0u); atomicStore(&bins[256u + lane], 0u); workgroupBarrier();
    var mask = 0u; if (shift < 24) { mask = 0xffffffffu << u32(shift + 8); }
    for (var i = lane; i < count; i += 256u) {
      let value = bitcast<u32>(cells[i].feature.z); let bin = (value >> u32(shift)) & 255u;
      for (var k = 0u; k < 2u; k++) { if ((value & mask) == prefixes[k]) { atomicAdd(&bins[k * 256u + bin], 1u); } }
    }
    workgroupBarrier(); if (lane < 2u) {
      var left = ranks[lane]; for (var bin = 0u; bin < 256u; bin++) {
        let n = atomicLoad(&bins[lane * 256u + bin]); if (left < n) { prefixes[lane] |= bin << u32(shift); ranks[lane] = left; break; } left -= n;
      }
    }
    workgroupBarrier();
  }
  if (lane == 0u) { let t = rank - floor(rank); threshold[0] = max(0.035, bitcast<f32>(prefixes[0]) * (1.0 - t) + bitcast<f32>(prefixes[1]) * t); }
}
@compute @workgroup_size(16, 16)
fn candidate(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= dimensions())) { return; } let i = id.y * grid.columns + id.x; let c = cells[i]; var flags = 0u;
  for (var light = 0u; light < 2u; light++) {
    let data = select(c.dark, c.bright, light != 0u); let difference = select(-1.0, 1.0, light != 0u) * (tone(data.xyz).x - c.base.x);
    if (data.w >= 0.025 && data.w <= 0.40 && c.feature[light] > 0.050 && difference > 0.055) { flags |= 1u << light; }
  }
  candidates[i] = flags;
}
@compute @workgroup_size(16, 16)
fn support(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= dimensions())) { return; } var neighbors = 0u;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) { if (x != 0 || y != 0) { neighbors |= candidates[cellAt(vec2<i32>(id.xy) + vec2<i32>(x, y))]; } } }
  let i = id.y * grid.columns + id.x; supported[i] = candidates[i] & neighbors;
}
fn nearest(point: vec3<f32>, index: u32, distances: ptr<function, array<f32, 16>>, indices: ptr<function, array<u32, 16>>) {
  let delta = point - palette(index) * vec3<f32>(1, 1.6, 1.6); let dist = dot(delta, delta);
  if (dist < (*distances)[15] || (dist == (*distances)[15] && index < (*indices)[15])) {
    var at = 15u; while (at > 0u) {
      if (!(dist < (*distances)[at - 1u] || (dist == (*distances)[at - 1u] && index < (*indices)[at - 1u]))) { break; }
      (*distances)[at] = (*distances)[at - 1u]; (*indices)[at] = (*indices)[at - 1u]; at--;
    }
    (*distances)[at] = dist; (*indices)[at] = index;
  }
}
@compute @workgroup_size(16, 16)
fn finish(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= dimensions())) { return; } let i = id.y * grid.columns + id.x; let c = cells[i]; let p = vec2<i32>(id.xy);
  let dirs = array<vec2<i32>, 4>(vec2<i32>(1, 0), vec2<i32>(1, 1), vec2<i32>(0, 1), vec2<i32>(-1, 1)); let d = dirs[min(3u, u32(c.feature.w))];
  let edge = c.feature.z > threshold[0] && c.feature.z >= cells[cellAt(p - d)].feature.z && c.feature.z > cells[cellAt(p + d)].feature.z;
  let base = c.base.xyz; var value = base;
  if (edge) { value.x -= min(0.065, max(0.0, value.x - 0.22) * 0.30); }
  for (var light = 0u; light < 2u; light++) { if ((supported[i] & (1u << light)) != 0u) {
    var count = 0u; for (var y = -2; y <= 2; y++) { for (var x = -2; x <= 2; x++) { count += select(0u, 1u, (supported[cellAt(p + vec2<i32>(x, y))] & (1u << light)) != 0u); } }
    let data = select(c.dark, c.bright, light != 0u); let cap = select(0.20, 0.18, light != 0u);
    let weight = clamp((c.feature[light] - 0.035) / 0.09, 0.0, 1.0) * clamp(data.w / 0.09, 0.0, 1.0) * 0.88 * clamp((0.65 - f32(count) / 25.0) / 0.30, 0.0, 1.0);
    if (weight > 0.10) { value = base + (tone(data.xyz) - base) * weight; value.x = clamp(value.x, base.x - cap, base.x + cap); }
  } }
  let a = cells[cellAt(p + vec2<i32>(1, 0))].base.x; let b = cells[cellAt(p - vec2<i32>(1, 0))].base.x;
  let cc = cells[cellAt(p + vec2<i32>(0, 1))].base.x; let dd = cells[cellAt(p - vec2<i32>(0, 1))].base.x;
  if (edge && max(max(a, b), max(cc, dd)) - min(min(a, b), min(cc, dd)) < 0.20 && value.x > 0.28) { value.x -= 0.035; }
  value.x = clamp(value.x, 0.19, 0.98); let point = value * vec3<f32>(1, 1.6, 1.6);
  var distances: array<f32, 16>; var indices: array<u32, 16>;
  for (var k = 0u; k < 16u; k++) { distances[k] = 3.4028234663852886e38; indices[k] = 65535u; }
  var exact = false;
  if (all(abs(value.yz) < vec2<f32>(0.25))) {
    let q = vec3<u32>(clamp(floor((value + vec3<f32>(0, 0.25, 0.25)) * vec3<f32>(32, 96, 96)), vec3<f32>(0), vec3<f32>(31, 47, 47)));
    let tile = (q.x * 48u + q.y) * 48u + q.z;
    let center = (vec3<f32>(q) + vec3<f32>(0.5)) / vec3<f32>(32, 96, 96) - vec3<f32>(0, 0.25, 0.25);
    let lower = max(0.0, tableFloat(116752u + tile * 4u) - length((value - center) * vec3<f32>(1, 1.6, 1.6)) - 1e-5);
    for (var k = 0u; k < 32u; k++) { nearest(point, tableByte(411664u + tile * 32u + k), &distances, &indices); }
    exact = distances[15] < lower * lower;
  }
  if (!exact) {
    for (var k = 0u; k < 16u; k++) { distances[k] = 3.4028234663852886e38; indices[k] = 65535u; }
    for (var k = 0u; k < 256u; k++) { nearest(point, k, &distances, &indices); }
  }
  let first = indices[0]; var second = first; var fraction = 0.0; var best = 3.4028234663852886e38;
  let anchor = palette(first) * vec3<f32>(1, 1.6, 1.6);
  for (var k = 0u; k < 16u; k++) {
    let index = indices[k]; let raw = palette(index) - palette(first);
    if (dot(raw.yz, raw.yz) > 0.025 * 0.025 || abs(raw.x) > 0.14) { continue; }
    let delta = palette(index) * vec3<f32>(1, 1.6, 1.6) - anchor; let square = dot(delta, delta);
    let t = clamp(dot(point - anchor, delta) / max(square, 1e-12), 0.0, 1.0); let residual = point - (anchor + t * delta);
    let cost = dot(residual, residual) + 0.06 * square;
    if (cost < best) { best = cost; second = index; fraction = t; }
  }
  let bayer = array<f32, 16>(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  let cutoff = (bayer[(id.y % 4u) * 4u + id.x % 4u] + 0.5) / 16.0;
  colors[i] = tables[(5136u / 4u) + select(first, second, fraction > cutoff)];
}
@compute @workgroup_size(16, 16)
fn expand(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= grid.width || id.y >= grid.height) { return; }
  let value = colors[(id.y / grid.size) * grid.columns + id.x / grid.size];
  textureStore(result, id.xy, vec4<f32>(f32((value >> 16u) & 255u), f32((value >> 8u) & 255u), f32(value & 255u), 255) / 255.0);
}
