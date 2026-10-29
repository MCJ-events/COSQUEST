// Weapon trail ribbon (cq 233): UV.x = age along the ribbon (0 newest),
// UV.y across it (0 hilt, 1 tip). Alpha-blended in a saturated tint with a white-hot
// leading edge, so it reads on the light paving (additive washed out to white there).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform vec4 tint : source_color = vec4(0.6, 0.85, 1.0, 1.0);
uniform sampler2D tex : source_color, filter_linear, repeat_disable;
uniform float alpha = 1.0;

void fragment() {
	float age = UV.x;
	float across = UV.y;
	vec4 t = texture(tex, vec2(1.0 - age, across));
	float body = smoothstep(0.0, 0.6, across) * (1.0 - smoothstep(0.93, 1.0, across));
	float fade = (1.0 - age) * (1.0 - age);
	float edge = smoothstep(0.72, 0.95, across) * (1.0 - smoothstep(0.97, 1.0, across)) * (1.0 - age);
	vec3 deep = tint.rgb * 0.75;
	ALBEDO = mix(deep, vec3(1.0, 0.98, 0.92), edge) * (0.9 + 0.3 * t.a);
	ALPHA = clamp((0.62 * body * fade + 0.5 * edge) * alpha * COLOR.a, 0.0, 1.0);
}
