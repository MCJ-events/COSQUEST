// Shop fronts at dusk (cq 011): the Kenney city kits share one colour atlas, and its glass
// swatches are the blue ones. Those texels glow warm, as lit windows do at dusk; the walls
// get a little warmth and saturation so the street reads like the reference, not grey boxes.
// One pass, no extra draw calls.
shader_type spatial;
render_mode cull_back, shadows_disabled;

uniform sampler2D atlas : source_color, filter_linear_mipmap;
uniform vec3 tint : source_color = vec3(1.0, 0.92, 0.95);
uniform vec3 window_col : source_color = vec3(1.0, 0.78, 0.45);
uniform float window_k = 2.4;
uniform float lift = 0.3;   // light bounced off the lit street: the walls never go black
uniform float sat = 1.25;

void fragment() {
	vec3 c = texture(atlas, UV).rgb;
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	vec3 s = mix(vec3(l), c, sat);
	float glass = smoothstep(0.12, 0.26, c.b - max(c.r, c.g));
	ALBEDO = mix(s * tint, vec3(0.08, 0.06, 0.1), glass * 0.7);
	EMISSION = window_col * glass * window_k * (0.75 + 0.5 * l) + s * tint * lift * (1.0 - glass);
	ROUGHNESS = 0.9;
}
