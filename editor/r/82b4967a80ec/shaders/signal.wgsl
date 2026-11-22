// Production grade and modern signal-damage stages, with SplitMix64 in u32 pairs.
struct DamageParameters { color: vec4<f32>, texture: vec4<f32>, shape: vec4<f32>, clock: vec4<f32>, geometry: vec4<u32> }
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var result: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> p: DamageParameters;
fn add64(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
  let lo = a.x + b.x; return vec2<u32>(lo, a.y + b.y + select(0u, 1u, lo < a.x));
}
fn shr64(a: vec2<u32>, n: u32) -> vec2<u32> { return vec2<u32>((a.x >> n) | (a.y << (32u - n)), a.y >> n); }
fn mul64(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
  let a0 = a.x & 65535u; let a1 = a.x >> 16u; let b0 = b.x & 65535u; let b1 = b.x >> 16u;
  let w0 = a0 * b0; let t = a1 * b0 + (w0 >> 16u); let w1 = (t & 65535u) + a0 * b1;
  return vec2<u32>((w1 << 16u) | (w0 & 65535u), a1 * b1 + (t >> 16u) + (w1 >> 16u) + a.x * b.y + a.y * b.x);
}
fn damageRandom(n: i32, seed: vec2<u32>) -> f32 {
  var h = add64(add64(vec2<u32>(bitcast<u32>(n), select(0u, 0xffffffffu, n < 0)), seed), vec2<u32>(0x7f4a7c15u, 0x9e3779b9u));
  h = mul64(h ^ shr64(h, 30u), vec2<u32>(0x1ce4e5b9u, 0xbf58476du));
  h = mul64(h ^ shr64(h, 27u), vec2<u32>(0x133111ebu, 0x94d049bbu)); h ^= shr64(h, 31u);
  return f32(h.y >> 8u) / 16777216.0;
}
fn damageNoise(x: f32, seed: vec2<u32>) -> f32 {
  let cell = floor(x); let f = x - cell; let u = f * f * (3.0 - 2.0 * f);
  return (damageRandom(i32(cell), seed) * (1.0 - u) + damageRandom(i32(cell) + 1, seed) * u) * 2.0 - 1.0;
}
fn envelope(d: f32) -> f32 { if (d < -0.7) { return 0; } return exp(-max(0.0, d + 0.7) * 2.2); }
fn bytes(rgb: vec3<f32>) -> vec4<f32> { return vec4<f32>(floor(clamp(rgb, vec3<f32>(0), vec3<f32>(1)) * 255.0 + 0.5) / 255.0, 1); }
fn yiq(rgb: vec3<f32>) -> vec3<f32> { return vec3<f32>(dot(rgb, vec3<f32>(0.299, 0.587, 0.114)), dot(rgb, vec3<f32>(0.596, -0.274, -0.322)), dot(rgb, vec3<f32>(0.211, -0.523, 0.312))); }
fn sampleYiq(x: f32, y: i32) -> vec3<f32> {
  let xx = clamp(x, 0.0, f32(textureDimensions(image).x - 1u)); let a = i32(xx); let b = min(i32(textureDimensions(image).x) - 1, a + 1);
  let first = yiq(textureLoad(image, vec2<i32>(a, y), 0).rgb);
  return first + (yiq(textureLoad(image, vec2<i32>(b, y), 0).rgb) - first) * (xx - f32(a));
}
@compute @workgroup_size(8, 8)
fn grade(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= textureDimensions(image))) { return; }
  let rgb = textureLoad(image, id.xy, 0).rgb; let y = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
  let mapped = pow(max(0.0, (y - p.shape.z) / (1.0 - p.shape.z)), p.shape.w);
  textureStore(result, id.xy, bytes(rgb * (mapped / max(y, 0.00001))));
}
@compute @workgroup_size(8, 8)
fn damage(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(image); if (any(id.xy >= size)) { return; }
  let pi = 3.14159265358979323846;
  let scale = f32(min(size.x, size.y)) / 720.0; let t = p.clock.y;
  let row = f32(id.y); let xx = f32(id.x); let height = f32(size.y); let y = i32(id.y); let seed = p.geometry.zw;
  let drift = p.shape.y * (0.36 * sin(t * 0.47) + 0.20 * sin(t * 0.83));
  let center = clamp(p.texture.w + drift + 0.006 * damageNoise(t * 0.65, seed ^ vec2<u32>(32u, 0u)), 0.03, 0.97) * height;
  let width = max(1.0, p.shape.x * height);
  let splitPhase = clamp((damageNoise(t * 0.22, seed ^ vec2<u32>(0x5f37u, 0u)) - 0.1) / 0.55, 0.0, 1.0);
  let split = p.shape.y * splitPhase * splitPhase * (3.0 - 2.0 * splitPhase);
  let separation = split * height * (0.06 + 0.025 * damageNoise(t * 0.37, seed ^ vec2<u32>(73u, 0u)));
  let d = (row - (center - separation * 0.35)) / width;
  let secondary = (row - (center + separation * 0.65)) / (width * (1.0 - split * 0.35));
  let band = p.texture.z * max(envelope(d), min(1.0, split * 5.0) * 0.78 * envelope(secondary));
  let jitter = damageNoise(row * 0.62 / max(0.4, scale) + t * 9.0, seed ^ vec2<u32>(69u, 0u));
  let shift = scale * (p.texture.x * jitter * 8.0 + band * (27.0 + 19.0 * jitter));
  let chromaShift = shift + band * scale * (17.0 + jitter * 11.0);
  let rowPhase = p.texture.x * damageNoise(row / max(1.0, 8.0 * scale) - t, seed ^ vec2<u32>(61u, 0u)) * 0.7;
  var v = sampleYiq(xx - shift, y); let color = sampleYiq(xx - chromaShift, y);
  let left = sampleYiq(xx - shift - 10.0 * scale, y).x; let right = sampleYiq(xx - shift + 10.0 * scale, y).x;
  let leakage = (right - left) * p.color.w * 1.8; var ii = color.y + leakage; var qq = color.z + leakage * 0.55;
  let slowY = (left + right + 2.0 * v.x) * 0.25;
  let phase = p.color.y * (slowY * 9.5 + 0.55 * sin(xx / max(1.0, 90.0 * scale) + t * 0.3)) + p.color.z * pi + rowPhase + band * (1.8 + jitter);
  let gain = 1.0 + p.color.x * 4.0; let cs = cos(phase); let sn = sin(phase); let oldI = ii;
  ii = (ii * cs - qq * sn) * gain; qq = (oldI * sn + qq * cs) * gain;
  if (p.texture.y > 0) {
    let length = (5.0 + 24.0 * damageRandom(i32(id.y / 2u), seed ^ vec2<u32>(113u, 0u))) * scale;
    let packetPhase = damageRandom(i32(id.y / 2u), seed ^ vec2<u32>(222u, 0u)) * 2.0 * pi + p.color.z * pi;
    let packet = max(0.0, damageNoise(xx / max(1.0, length) + row * 33.0 + t * 4.0, seed ^ vec2<u32>(121u, 0u)) - 0.35);
    let amount = packet * packet * p.texture.y * 0.22;
    ii += amount * cos(packetPhase); qq += amount * sin(packetPhase); v.x += amount * 0.12;
  }
  if (band > 0) {
    let grit = damageNoise(xx / max(1.0, 2.0 * scale) + row * 71.0 + t * 23.0, seed ^ vec2<u32>(777u, 0u));
    let packet = max(0.0, damageNoise(xx / max(1.0, 30.0 * scale) + row * 9.0 + t * 3.0, seed ^ vec2<u32>(888u, 0u)));
    v.x = v.x * (1.0 - band * 0.5) + band * (0.30 + grit * 0.45 + packet * 0.45);
    ii += band * grit * 0.12; qq -= band * grit * 0.08;
    let rainbowPhase = xx / max(1.0, 60.0 * scale) + t * 0.8;
    ii += band * p.clock.z * 0.3 * cos(rainbowPhase); qq += band * p.clock.z * 0.3 * sin(rainbowPhase);
  }
  textureStore(result, id.xy, bytes(vec3<f32>(v.x + 0.956 * ii + 0.621 * qq, v.x - 0.272 * ii - 0.647 * qq, v.x - 1.106 * ii + 1.703 * qq)));
}
