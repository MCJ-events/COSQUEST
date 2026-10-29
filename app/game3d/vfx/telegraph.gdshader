// Boss telegraph on the ground (cq 233): a circle (half_angle = PI) or a cone
// opening towards local +Z, drawn on a unit PlaneMesh scaled to the radius.
// The fill grows from the centre to the edge over the wind-up, so the strike
// lands exactly when the fill meets the rim: that is the parry / dodge cue.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform vec4 tint : source_color = vec4(1.0, 0.18, 0.12, 1.0);
uniform float fill : hint_range(0.0, 1.0) = 0.0;
uniform float half_angle = 3.1416;
uniform float alpha = 1.0;
uniform float flash = 0.0;

void fragment() {
	vec2 p = (UV - 0.5) * 2.0;
	float r = length(p);
	float ang = abs(atan(p.x, p.y));
	float aa = fwidth(r) * 1.5;
	float inside = (1.0 - smoothstep(1.0 - aa, 1.0, r)) * (1.0 - smoothstep(half_angle - 0.02, half_angle, ang));
	if (inside <= 0.001) discard;
	float rim = smoothstep(0.86, 0.96, r);
	float side = 0.0;
	if (half_angle < 3.1) {
		float d = (half_angle - ang) * r;   // distance to the cone's side line
		side = 1.0 - smoothstep(0.0, 0.06, d);
	}
	float filled = 1.0 - smoothstep(fill - aa, fill, r);
	float front = smoothstep(fill - 0.08, fill, r) * filled;
	float a = 0.14 + 0.30 * filled + 0.45 * max(rim, side) + 0.4 * front;
	vec3 c = tint.rgb * (0.75 + 0.6 * front + 0.4 * rim) + vec3(flash);
	ALBEDO = c;
	ALPHA = clamp(a * inside * alpha * tint.a, 0.0, 1.0);
}
