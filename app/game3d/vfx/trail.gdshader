// Weapon trail ribbon (cq 233): UV.x = age along the ribbon (0 newest),
// UV.y across it (0 hilt, 1 tip). Alpha-blended in a saturated tint with a white-hot
// leading edge, so it reads on the light paving; trail_glow.gdshader (next pass) adds
// the additive halo that makes it read as light, as on the reference.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform vec4 tint : source_color = vec4(0.6, 0.85, 1.0, 1.0);
uniform sampler2D tex : source_color, filter_linear, repeat_disable;
uniform float alpha = 1.0;

void fragment() {
	float age = UV.x;
	float across = UV.y;
	vec4 t = texture(tex, vec2(1.0 - age, across));
	float body = smoothstep(0.0, 0.55, across) * (1.0 - smoothstep(0.97, 1.0, across));
	float fade = 1.0 - age;
	fade *= fade;
	float edge = smoothstep(0.8, 0.94, across) * (1.0 - smoothstep(0.975, 1.0, across)) * (1.0 - age * 0.7);
	// saturated colour in the body, white-hot along the cutting edge
	vec3 deep = mix(tint.rgb * 0.7, tint.rgb, across);
	ALBEDO = mix(deep, vec3(1.0, 0.99, 0.94), edge) * (0.92 + 0.2 * t.a);
	ALPHA = clamp((0.85 * body * fade + 0.9 * edge) * alpha * COLOR.a, 0.0, 1.0);
}
