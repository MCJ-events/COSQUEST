// SHIELD barrier (cq 233): a fresnel bubble with slow bands, additive.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_back, shadows_disabled;

uniform vec4 tint : source_color = vec4(0.3, 0.68, 1.0, 1.0);
uniform float alpha = 1.0;
uniform float hit = 0.0;

void fragment() {
	float f = 1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float rim = pow(f, 2.2);
	float bands = 0.5 + 0.5 * sin((UV.y * 40.0) - TIME * 3.0);
	float a = (0.06 + 0.6 * rim + 0.05 * bands) * alpha;
	ALBEDO = tint.rgb * a * (1.0 + 2.0 * hit);
}
