// Additive halo over the weapon trail (next pass of trail.gdshader): brightest just
// inside the edge, so the ribbon glows like the reference's slash arcs.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled;

uniform vec4 tint : source_color = vec4(0.6, 0.85, 1.0, 1.0);
uniform float alpha = 1.0;

void fragment() {
	float age = UV.x;
	float across = UV.y;
	float band = 0.6 * smoothstep(0.5, 0.92, across) * (1.0 - smoothstep(0.98, 1.0, across));
	float fade = 1.0 - age;
	ALBEDO = tint.rgb * 0.8;
	ALPHA = clamp(band * fade * fade * alpha * COLOR.a, 0.0, 1.0);
}
