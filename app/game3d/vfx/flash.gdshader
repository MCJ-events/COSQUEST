// Fighter overlay (cq 233): a team-coloured rim light that lifts the
// characters off the ground at phone size, plus the white hit flash.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_back, shadows_disabled;

uniform vec4 rim_color : source_color = vec4(0.5, 0.8, 1.0, 1.0);
uniform float rim_amount = 0.35;
uniform float flash = 0.0;

void fragment() {
	float f = 1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	vec3 c = rim_color.rgb * pow(f, 3.0) * rim_amount + vec3(1.0, 0.95, 0.9) * flash * (0.55 + 0.45 * f);
	ALBEDO = c;
}
