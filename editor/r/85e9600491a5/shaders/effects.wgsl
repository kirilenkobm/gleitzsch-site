// Port of production spatialCompose, signalDamageSoften and CRT passes.
// The CRT tables retain the production BGR channel convention.
struct Parameters {
  effects: vec4<f32>,
  geometry: vec4<u32>,
  spatial: vec4<f32>,
  detail: vec4<f32>,
}

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var history0: texture_2d<f32>;
@group(0) @binding(2) var history1: texture_2d<f32>;
@group(0) @binding(3) var history2: texture_2d<f32>;
@group(0) @binding(4) var outputImage: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var light: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> p: Parameters;
@group(0) @binding(7) var<storage, read> linear: array<f32>;
@group(0) @binding(8) var<storage, read> encoded: array<u32>;
@group(0) @binding(9) var<storage, read> beam: array<f32>;
@group(0) @binding(10) var<storage, read> mask: array<f32>;
@group(0) @binding(11) var<storage, read> weights: array<f32>;

fn sampleSource(uv: vec2<f32>) -> vec4<f32> {
  let last = vec2<i32>(textureDimensions(source)) - vec2<i32>(1);
  let at = uv * vec2<f32>(last + vec2<i32>(1)) - vec2<f32>(0.5);
  let lo = vec2<i32>(floor(at));
  let f = at - vec2<f32>(lo);
  let a = textureLoad(source, clamp(lo, vec2<i32>(0), last), 0);
  let b = textureLoad(source, clamp(lo + vec2<i32>(1, 0), vec2<i32>(0), last), 0);
  let c = textureLoad(source, clamp(lo + vec2<i32>(0, 1), vec2<i32>(0), last), 0);
  let d = textureLoad(source, clamp(lo + vec2<i32>(1, 1), vec2<i32>(0), last), 0);
  let top = a + (b - a) * f.x;
  let bottom = c + (d - c) * f.x;
  return top + (bottom - top) * f.y;
}

fn quantize(rgb: vec3<f32>) -> vec4<f32> {
  return vec4<f32>(floor(clamp(rgb, vec3<f32>(0), vec3<f32>(1)) * 255.0 + 0.5) / 255.0, 1);
}

@compute @workgroup_size(8, 8)
fn spatial(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(outputImage);
  if (any(id.xy >= size)) { return; }
  let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
  var rgb = sampleSource(uv).rgb;
  if (p.spatial.x > 0) {
    let amount = 0.055 * p.spatial.x;
    rgb = vec3<f32>(sampleSource(vec2<f32>(0.5) + (uv - vec2<f32>(0.5)) * (1 + amount)).r,
                    sampleSource(uv).g,
                    sampleSource(vec2<f32>(0.5) + (uv - vec2<f32>(0.5)) * (1 - amount)).b);
  }
  textureStore(outputImage, id.xy, vec4<f32>(clamp(rgb, vec3<f32>(0), vec3<f32>(1)), 1));
}

@compute @workgroup_size(8, 8)
fn resize(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(outputImage);
  if (any(id.xy >= size)) { return; }
  textureStore(outputImage, id.xy, sampleSource((vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size)));
}

@compute @workgroup_size(8, 8)
fn soften(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(source);
  if (any(id.xy >= size)) { return; }
  let pos = vec2<i32>(id.xy);
  let radius = max(1, i32(floor(1.5 * f32(min(size.x, size.y)) / 720.0 + 0.5)));
  let left = vec2<i32>(max(0, pos.x - radius), pos.y);
  let right = vec2<i32>(min(i32(size.x) - 1, pos.x + radius), pos.y);
  let a = p.spatial.y * 0.5;
  let rgb = textureLoad(source, pos, 0).rgb * (1 - 2 * a)
    + textureLoad(source, left, 0).rgb * a + textureLoad(source, right, 0).rgb * a;
  textureStore(outputImage, pos, quantize(rgb));
}

fn crtLinear(rgb: vec3<f32>) -> vec3<f32> {
  let bgr = vec3<u32>(floor(rgb.bgr * 255.0 + 0.5));
  return vec3<f32>(linear[bgr.x], linear[bgr.y], linear[bgr.z]);
}

fn encodedByte(index: u32) -> f32 {
  return f32((encoded[index / 4u] >> ((index % 4u) * 8u)) & 255u);
}

fn crtEncoded(bgr: vec3<f32>) -> vec4<f32> {
  let i = vec3<u32>(clamp(floor(bgr * 65535.0 + 0.5), vec3<f32>(0), vec3<f32>(65535)));
  return vec4<f32>(vec3<f32>(encodedByte(i.z), encodedByte(i.y), encodedByte(i.x)) / 255.0, 1);
}

@compute @workgroup_size(8, 8)
fn raster(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= textureDimensions(source))) { return; }
  let pos = vec2<i32>(id.xy);
  var value = crtLinear(textureLoad(source, pos, 0).rgb);
  let alpha = clamp(p.effects.w * 0.76, 0.0, 0.82);
  let count = p.geometry.x;
  if (alpha > 0 && count > 0u) {
    let decays = vec3<f32>(alpha * 0.90, min(0.86, alpha * 1.05), alpha);
    var weight = decays;
    value *= vec3<f32>(1) - decays;
    value += crtLinear(textureLoad(history0, pos, 0).rgb)
      * select(weight * (vec3<f32>(1) - decays), weight, count == 1u);
    weight *= decays;
    if (count > 1u) {
      value += crtLinear(textureLoad(history1, pos, 0).rgb)
        * select(weight * (vec3<f32>(1) - decays), weight, count == 2u);
    }
    weight *= decays;
    if (count > 2u) { value += crtLinear(textureLoad(history2, pos, 0).rgb) * weight; }
  }
  if (p.effects.x != 0) {
    let intensity = clamp(dot(value, vec3<f32>(0.0722, 0.7152, 0.2126)), 0.0, 1.0) * 16.0;
    let level = min(15u, u32(intensity));
    let base = id.y * 17u + level;
    let profile = beam[base] + (beam[base + 1u] - beam[base]) * (intensity - f32(level));
    value *= 1 + p.effects.x * (profile - 1);
  }
  if (p.effects.y != 0) {
    let base = id.x * 3u;
    let aperture = vec3<f32>(mask[base], mask[base + 1u], mask[base + 2u]);
    value *= vec3<f32>(1) + (aperture - vec3<f32>(1)) * p.effects.y;
  }
  if (p.effects.z > 0) { textureStore(light, pos, vec4<f32>(value, 1)); }
  else { textureStore(outputImage, pos, crtEncoded(value)); }
}

// The intermediate reduce and blur images retain half-float quantization.
@group(0) @binding(12) var halfTarget: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn reduce(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= textureDimensions(halfTarget))) { return; }
  let size = textureDimensions(source);
  var sum = vec3<f32>(0);
  var count = 0u;
  for (var y = 0u; y < 4u; y++) {
    for (var x = 0u; x < 4u; x++) {
      let at = id.xy * 4u + vec2<u32>(x, y);
      if (all(at < size)) { sum += textureLoad(source, at, 0).rgb; count++; }
    }
  }
  textureStore(halfTarget, id.xy, vec4<f32>(sum / f32(count), 1));
}

@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= textureDimensions(halfTarget))) { return; }
  let last = vec2<i32>(textureDimensions(source)) - vec2<i32>(1);
  let radius = i32(p.geometry.y);
  var value = vec3<f32>(0);
  for (var k = -radius; k <= radius; k++) {
    let offset = select(vec2<i32>(0, k), vec2<i32>(k, 0), p.geometry.z != 0u);
    let at = clamp(vec2<i32>(id.xy) + offset, vec2<i32>(0), last);
    value += textureLoad(source, at, 0).rgb * weights[u32(k + radius)];
  }
  textureStore(halfTarget, id.xy, vec4<f32>(value, 1));
}

@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= textureDimensions(outputImage))) { return; }
  let last = vec2<i32>(textureDimensions(history0)) - vec2<i32>(1);
  let at = clamp((vec2<f32>(id.xy) + vec2<f32>(0.5)) / 4.0 - vec2<f32>(0.5), vec2<f32>(0), vec2<f32>(last));
  let lo = vec2<i32>(at);
  let hi = min(last, lo + vec2<i32>(1));
  let f = at - vec2<f32>(lo);
  let a = textureLoad(history0, lo, 0).rgb;
  let b = textureLoad(history0, vec2<i32>(hi.x, lo.y), 0).rgb;
  let c = textureLoad(history0, vec2<i32>(lo.x, hi.y), 0).rgb;
  let d = textureLoad(history0, hi, 0).rgb;
  let top = a + (b - a) * f.x;
  let bottom = c + (d - c) * f.x;
  let scattered = top + (bottom - top) * f.y;
  var value = textureLoad(source, id.xy, 0).rgb;
  value += (scattered - value) * p.effects.z * 0.40;
  textureStore(outputImage, id.xy, crtEncoded(value));
}

@compute @workgroup_size(8, 8)
fn curve(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(source);
  if (any(id.xy >= size)) { return; }
  if (any(id.xy == vec2<u32>(0)) || any(id.xy == size - vec2<u32>(1))) {
    textureStore(outputImage, id.xy, textureLoad(source, id.xy, 0));
    return;
  }
  let last = vec2<f32>(size - vec2<u32>(1));
  let point = vec2<f32>(id.xy) / last * 2 - vec2<f32>(1);
  let fade = (1 - point.x * point.x) * (1 - point.y * point.y);
  let q = point * (1 - p.spatial.z * fade);
  // sampleSource uses texel-center UV, while the curve maps endpoints.
  let uv = ((q + vec2<f32>(1)) * 0.5 * last + vec2<f32>(0.5)) / vec2<f32>(size);
  textureStore(outputImage, id.xy, quantize(sampleSource(uv).rgb));
}

@vertex
fn fullscreen(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(vec2<f32>(-1, -1), vec2<f32>(3, -1), vec2<f32>(-1, 3));
  return vec4<f32>(positions[index], 0, 1);
}

@fragment
fn present(@builtin(position) point: vec4<f32>) -> @location(0) vec4<f32> {
  return textureLoad(source, vec2<i32>(point.xy), 0);
}
