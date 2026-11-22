// Upright photo path of production highlightMask/halo/spatialCompose/stripes.
struct SpatialParameters { effects: vec4<f32>, shape: vec4<f32>, detail: vec4<f32>, flags: vec4<u32> }
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var auxiliary: texture_2d<f32>;
@group(0) @binding(2) var result: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var halfResult: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> p: SpatialParameters;

fn linearSample(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
  let last = vec2<i32>(textureDimensions(tex)) - vec2<i32>(1);
  let at = uv * vec2<f32>(last + vec2<i32>(1)) - vec2<f32>(0.5);
  let lo = vec2<i32>(floor(at)); let f = at - vec2<f32>(lo);
  let a = textureLoad(tex, clamp(lo, vec2<i32>(0), last), 0);
  let b = textureLoad(tex, clamp(lo + vec2<i32>(1, 0), vec2<i32>(0), last), 0);
  let c = textureLoad(tex, clamp(lo + vec2<i32>(0, 1), vec2<i32>(0), last), 0);
  let d = textureLoad(tex, clamp(lo + vec2<i32>(1, 1), vec2<i32>(0), last), 0);
  let top = a + (b - a) * f.x; let bottom = c + (d - c) * f.x;
  return top + (bottom - top) * f.y;
}
fn spatialHash(value: u32) -> u32 {
  var n = value; n ^= n >> 16u; n *= 0x7feb352du; n ^= n >> 15u; n *= 0x846ca68bu; return n ^ (n >> 16u);
}
fn randomSigned(n: u32) -> f32 { return f32(spatialHash(n) & 0xffffu) / 32767.5 - 1.0; }

@compute @workgroup_size(8, 8)
fn highlights(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= textureDimensions(halfResult))) { return; }
  var sum = 0.0; var count = 0u;
  let threshold = 0.45 + 0.5 * p.shape.y;
  for (var y = 0u; y < 4u; y++) { for (var x = 0u; x < 4u; x++) {
    let at = id.xy * 4u + vec2<u32>(x, y);
    if (all(at < textureDimensions(image))) {
      sum += smoothstep(threshold - 0.08, threshold + 0.04, dot(textureLoad(image, at, 0).rgb, vec3<f32>(1.0 / 3.0)));
      count++;
    }
  } }
  textureStore(halfResult, id.xy, vec4<f32>(sum / f32(max(1u, count))));
}
@compute @workgroup_size(8, 8)
fn halo(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(halfResult); if (any(id.xy >= size)) { return; }
  let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
  let weights = array<f32, 5>(0.2041637, 0.1801738, 0.1238315, 0.0662822, 0.0276306);
  var v = linearSample(image, uv).r * weights[0];
  for (var i = 1u; i <= 4u; i++) {
    v += weights[i] * (linearSample(image, uv + p.detail.xy * f32(i)).r + linearSample(image, uv - p.detail.xy * f32(i)).r);
  }
  textureStore(halfResult, id.xy, vec4<f32>(v));
}
@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(result); if (any(id.xy >= size)) { return; }
  var uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
  let scale = f32(min(size.x, size.y)) / 720.0;
  var darkness = 1.0;
  if (p.effects.w > 0) {
    let stripeHeight = max(1.0, (2.0 + 10.0 * p.shape.w) * scale);
    let stripe = u32(floor(uv.y * f32(size.y) / stripeHeight));
    darkness = 1.0 - select(0.0, 0.65 * p.effects.w, (stripe & 1u) != 0u);
    uv.x += randomSigned(stripe + 17u) * 6.0 * scale * p.effects.w * p.detail.z / f32(size.x);
  }
  var rgb = linearSample(image, uv).rgb;
  if (p.effects.x > 0) {
    let amount = 0.055 * p.effects.x;
    rgb = vec3<f32>(linearSample(image, vec2<f32>(0.5) + (uv - vec2<f32>(0.5)) * (1.0 + amount)).r,
      linearSample(image, uv).g, linearSample(image, vec2<f32>(0.5) + (uv - vec2<f32>(0.5)) * (1.0 - amount)).b);
  }
  if (p.effects.y > 0) {
    let spread = 0.015 + 0.14 * p.shape.z;
    var glow = vec3<f32>(linearSample(auxiliary, vec2<f32>(0.5) + (uv - vec2<f32>(0.5)) * (1.0 - spread)).r,
      linearSample(auxiliary, uv).r, linearSample(auxiliary, vec2<f32>(0.5) + (uv - vec2<f32>(0.5)) * (1.0 + spread)).r);
    glow -= vec3<f32>(0.85 * min(glow.r, min(glow.g, glow.b)));
    rgb += glow * p.effects.y * 1.5;
  }
  if (p.effects.z > 0) {
    let xy = vec2<u32>(id.xy);
    let seed = (xy.x * 73856093u) ^ (xy.y * 19349663u);
    rgb += vec3<f32>((randomSigned(seed) + randomSigned(seed ^ 0x9e3779b9u)) * 0.075 * p.effects.z);
  }
  textureStore(result, id.xy, vec4<f32>(clamp(rgb * darkness, vec3<f32>(0), vec3<f32>(1)), 1));
}
@compute @workgroup_size(8, 8)
fn luma(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(image); if (any(id.xy >= size)) { return; }
  let radius = max(1, i32(floor(f32(min(size.x, size.y)) / 100.0 + 0.5)));
  var sum = 0.0;
  for (var dx = -radius; dx <= radius; dx++) {
    let x = clamp(i32(id.x) + dx, 0, i32(size.x) - 1);
    sum += dot(textureLoad(image, vec2<i32>(x, i32(id.y)), 0).rgb, vec3<f32>(0.299, 0.587, 0.114));
  }
  textureStore(halfResult, id.xy, vec4<f32>(sum / f32(2 * radius + 1)));
}
@compute @workgroup_size(8, 8)
fn stripes(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(image); if (any(id.xy >= size)) { return; }
  let radius = max(1, i32(floor(f32(min(size.x, size.y)) / 100.0 + 0.5)));
  var lum = 0.0;
  for (var dy = -radius; dy <= radius; dy++) {
    let y = clamp(i32(id.y) + dy, 0, i32(size.y) - 1);
    lum += textureLoad(auxiliary, vec2<i32>(i32(id.x), y), 0).r;
  }
  lum /= f32(2 * radius + 1);
  let amount = clamp(p.effects.x, 0.0, 1.0); let color = amount * 0.22;
  let original = textureLoad(image, id.xy, 0).rgb;
  let Y = dot(original, vec3<f32>(0.299, 0.587, 0.114));
  let I = dot(original, vec3<f32>(0.596, -0.274, -0.322));
  let Q = dot(original, vec3<f32>(0.211, -0.523, 0.312));
  let hue = color * (lum * 7.0 - 2.0); let cs = cos(hue); let sn = sin(hue);
  let ci = (I * cs - Q * sn) * (1.0 + color * 1.6); let cq = (I * sn + Q * cs) * (1.0 + color * 1.6);
  let rgb = vec3<f32>(Y) + vec3<f32>(0.956, -0.272, -1.106) * ci + vec3<f32>(0.621, -0.647, 1.703) * cq;
  var uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
  var displaySize = vec2<f32>(size);
  if (p.flags.z != 0u) { uv = uv.yx; displaySize = displaySize.yx; }
  let cycles = 6.0 + 34.0 * clamp(p.effects.y, 0.0, 1.0);
  let x = uv.x - 0.5 / 384.0; let y = uv.y * (384.0 * displaySize.y / displaySize.x) - 0.5;
  let phase = 6.28318530718 * cycles * x + (2.0 + 14.0 * amount) * (lum - 0.5) + 0.12 * amount * sin(y * 0.13);
  let channelPhase = vec3<f32>(phase) + vec3<f32>(-1, 0, 1) * (0.10 + 0.30 * amount) + color * (rgb - vec3<f32>(Y)) * 1.2;
  let pulse = pow(clamp(vec3<f32>(0.5) + 0.5 * cos(channelPhase), vec3<f32>(0), vec3<f32>(1)), vec3<f32>(1.2 + 3.8 * amount));
  let ink = clamp(rgb, vec3<f32>(0), vec3<f32>(1)) * 0.045;
  let line = (vec3<f32>(0.28) + 0.9 * clamp(rgb, vec3<f32>(0), vec3<f32>(1))) * smoothstep(0.018, 0.14, Y) * pulse;
  textureStore(result, id.xy, vec4<f32>(clamp(mix(rgb, ink + line, amount), vec3<f32>(0), vec3<f32>(1)), 1));
}
