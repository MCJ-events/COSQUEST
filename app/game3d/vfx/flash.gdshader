// Fighter overlay (cq 233): a team-coloured rim light plus the white hit flash.
// cq 013: the flash reads as an impact. Build 21: the hit is a warm fresnel rim only (a white
// body read as a missing texture); the white-hot core is the dissolve's glow.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_back, shadows_disabled;

uniform vec4 rim_color : source_color = vec4(0.5, 0.8, 1.0, 1.0);
uniform float rim_amount = 0.35;
uniform float flash = 0.0;
uniform float glow = 0.0;

// build 21: the hit is a warm rim (no white body); the dissolve's glow keeps the white-hot core
void fragment() {
	float f = 1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float body = smoothstep(0.35, 1.0, glow);
	vec3 c = rim_color.rgb * pow(f, 3.0) * rim_amount
		+ vec3(1.0, 0.86, 0.62) * flash * (0.05 + 1.1 * pow(f, 2.5))
		+ vec3(1.0, 0.97, 0.92) * glow * (0.6 * body + 0.75 * pow(f, 1.5))
		+ vec3(1.0, 0.85, 0.6) * glow * pow(f, 3.0) * 0.6;
	ALBEDO = c;
}
