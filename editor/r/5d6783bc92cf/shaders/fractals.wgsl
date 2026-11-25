struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
struct Parameters { sourceSize: vec2f, outputSize: vec2f, amount: f32, detail: f32, padding: vec2f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sampling: sampler;
@group(0) @binding(2) var<uniform> p: Parameters;
@group(0) @binding(3) var field: texture_2d<f32>;
@group(0) @binding(4) var fieldSampling: sampler;

@vertex fn fullscreen(@builtin(vertex_index) id: u32) -> Vertex {
    let point = vec2f(f32((id << 1u) & 2u), f32(id & 2u));
    return Vertex(vec4f(point * 2.0 - 1.0, 0.0, 1.0), vec2f(point.x, 1.0 - point.y));
}
@fragment fn mipmap(in: Vertex) -> @location(0) vec4f {
    return textureSampleLevel(source, sampling, in.uv, 0.0);
}
fn imageUV(uv: vec2f) -> vec2f { return vec2f(uv.x, 1.0 - uv.y); }
fn light(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
fn turn(q: vec2f, angle: f32) -> vec2f {
    let c = cos(angle); let s = sin(angle);
    return vec2f(c * q.x - s * q.y, s * q.x + c * q.y);
}
fn color(uv: vec2f, lod: f32) -> vec3f {
    return textureSampleLevel(source, sampling, imageUV(uv), lod).rgb;
}
@fragment fn grow(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let uv = imageUV(position.xy / p.outputSize);
    let shortEdge = min(p.sourceSize.x, p.sourceSize.y);
    let metric = vec2f(shortEdge) / p.sourceSize;
    let radius = 0.16 / p.detail;
    let lod = max(0.0, log2(max(1.0, radius * shortEdge * 0.7)));
    let center = color(uv, lod);
    let r = color(uv + vec2f(radius, 0.0) * metric, lod);
    let l = color(uv - vec2f(radius, 0.0) * metric, lod);
    let t = color(uv + vec2f(0.0, radius) * metric, lod);
    let b = color(uv - vec2f(0.0, radius) * metric, lod);
    let gradient = vec2f(light(r - l), light(t - b));
    let curvature = light(center - (r + l + t + b) * 0.25);
    let energy = length(gradient) + abs(curvature) * 2.0;
    let activity = smoothstep(0.008, 0.09, energy);
    var q = vec2f(gradient.x + curvature * 1.7, gradient.y - curvature * 1.7) / (energy + 0.065) * 2.4;
    var flow = vec2f(0.0); var trap = 2.0; var weight = 0.5;
    for (var i = 0; i < 7; i++) {
        q = turn(abs(q) / clamp(dot(q, q), 0.18, 3.5), 0.61) - vec2f(0.86, 0.62);
        trap = min(trap, abs(length(q) - 0.72) + f32(i) * 0.004);
        flow += weight * q / (1.0 + dot(q, q));
        weight *= 0.6;
    }
    let resolved = 1.0 - smoothstep(0.025, 0.18, fwidth(trap));
    let relief = cos(trap * 55.0) * resolved;
    return vec4f(flow * radius * metric * activity * 0.65, relief, activity);
}
@fragment fn composite(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let nativeUV = position.xy / p.outputSize;
    let uv = imageUV(nativeUV);
    let f = textureSampleLevel(field, fieldSampling, nativeUV, 0.0);
    let displacement = f.xy * p.amount;
    let original = textureLoad(source, vec2i(position.xy), 0).rgb;
    let a = color(uv + displacement, 0.0);
    let c = color(uv + displacement * 0.55, 0.0);
    let grown = mix(a, c, vec3f(0.25)) * (1.0 + f.z * f.w * p.amount * 0.5);
    return vec4f(clamp(mix(original, grown, vec3f(p.amount * 0.9)), vec3f(0.0), vec3f(1.0)), 1.0);
}
