// The real place's buildings at dusk (cq 019, place.gd): facade.gdshader's look (lit windows glow warm,
// hemisphere ambient, dusk depth, contact shade) on a generated wall-and-window texture that repeats
// along every wall (UV in bays and floors). Roofs use the same texture's wall colour.
//
// env-fixes 2 (audit issues 3, 6, 11): no pink tint and no self-lift on the walls (they had both, so
// every wall sat in one mauve band), and the lit windows are warm interiors, not white: the texture
// carries each lit window's dim level (red) and which of three warm tints it has (green), with blue
// high to mark it as glass (place.gd _wall_texture). The glow is clamped (was 2.6x: it clipped).
shader_type spatial;
render_mode cull_back, shadows_disabled;

uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 tint : source_color = vec3(1.0);
uniform vec3 warm_a : source_color = vec3(1.0, 0.7, 0.4);     // tungsten
uniform vec3 warm_b : source_color = vec3(1.0, 0.82, 0.58);   // warm white
uniform vec3 warm_c : source_color = vec3(0.95, 0.58, 0.34);  // amber behind a curtain
uniform float window_k = 1.2;
uniform float windows_k_mul = 1.0;   // the time of day (arena.gd TIMES "windows")
uniform float lift = 0.0;
uniform float sat = 1.05;
uniform float ao_height = 2.2;
uniform float ao_min = 0.55;
uniform vec3 hemi_up : source_color = vec3(0.54, 0.6, 0.98);
uniform vec3 hemi_horizon : source_color = vec3(0.8, 0.74, 0.9);
uniform vec3 hemi_ground : source_color = vec3(0.6, 0.48, 0.5);
uniform float hemi_energy = 0.0;
uniform vec3 dusk_col : source_color = vec3(1.0);
uniform vec2 dusk_z = vec2(-6.0, -30.0);
uniform float roof_dark = 0.62;

varying float wy;
varying float wz;

vec3 hemi_extra(vec3 nw) {
	vec3 c = nw.y > 0.0 ? mix(hemi_horizon, hemi_up, nw.y) : mix(hemi_horizon, hemi_ground, -nw.y);
	return (c - hemi_up) * hemi_energy;
}

void vertex() {
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wy = wp.y;
	wz = wp.z;
}

void fragment() {
	vec3 nw = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
	bool roof = nw.y > 0.7;
	vec3 c = roof ? texture(atlas, vec2(0.02, 0.02)).rgb * roof_dark : texture(atlas, UV).rgb;
	float glass = roof ? 0.0 : smoothstep(0.12, 0.26, c.b - max(c.r, c.g));
	// a lit window's data, written in sRGB (place.gd): level = red / 0.6, tint pick = green / 0.6
	vec3 cs = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
	float level = clamp(cs.r / 0.6, 0.0, 1.0);
	float pick = clamp(cs.g / 0.6, 0.0, 1.0);
	vec3 warm = mix(mix(warm_a, warm_b, clamp(pick * 2.0, 0.0, 1.0)), warm_c, clamp(pick * 2.0 - 1.0, 0.0, 1.0));
	// where a lit window's texels blend into the wall (filtering), keep its blue out of the wall colour,
	// or every window gets a violet frame
	vec3 cw = vec3(c.r, c.g, min(c.b, max(c.r, c.g) * 1.05));
	float l = dot(cw, vec3(0.299, 0.587, 0.114));
	vec3 s = mix(vec3(l), cw, sat);
	float ao = mix(ao_min, 1.0, smoothstep(0.0, ao_height, wy));
	vec3 dusk = mix(vec3(1.0), dusk_col, smoothstep(dusk_z.x, dusk_z.y, wz));
	ALBEDO = mix(s * tint * ao * dusk, vec3(0.05, 0.045, 0.05), glass * 0.85);
	EMISSION = min(warm * level * window_k * windows_k_mul, vec3(1.2)) * glass + s * tint * lift * ao * dusk * (1.0 - glass);
	ROUGHNESS = 0.9;
	EMISSION += ALBEDO * hemi_extra(nw) * ao;
}
