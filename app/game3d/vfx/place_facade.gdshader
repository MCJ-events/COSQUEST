// The real place's buildings at dusk (cq 019, place.gd): facade.gdshader's look (lit windows glow warm,
// walls lifted, hemisphere ambient, dusk depth, contact shade) on a generated wall-and-window texture
// that repeats along every wall (UV in bays and floors). Roofs use the same texture's wall colour.
shader_type spatial;
render_mode cull_back, shadows_disabled;

uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 tint : source_color = vec3(1.0, 0.92, 0.95);
uniform vec3 window_col : source_color = vec3(1.0, 0.78, 0.45);
uniform float window_k = 2.6;
uniform float lift = 0.12;
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
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	vec3 s = mix(vec3(l), c, sat);
	float glass = roof ? 0.0 : smoothstep(0.12, 0.26, c.b - max(c.r, c.g));
	float ao = mix(ao_min, 1.0, smoothstep(0.0, ao_height, wy));
	vec3 dusk = mix(vec3(1.0), dusk_col, smoothstep(dusk_z.x, dusk_z.y, wz));
	ALBEDO = mix(s * tint * ao * dusk, vec3(0.08, 0.06, 0.1), glass * 0.7);
	EMISSION = window_col * glass * window_k * (0.75 + 0.5 * l) + s * tint * lift * ao * dusk * (1.0 - glass);
	ROUGHNESS = 0.9;
	EMISSION += ALBEDO * hemi_extra(nw) * ao;
}
