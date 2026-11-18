// cq 013: the body of fx_card.gdshader and fx_card_top.gdshader (see fx_card.gdshader).

uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_disable;
uniform float cell = 0.0;
uniform vec4 tint : source_color = vec4(1.0);
uniform float add = 0.6;
uniform float hot = 0.0;
uniform float intensity = 1.0;
uniform int billboard = 1;
uniform float spin = 0.0;
// realism round 4: on the close camera a hit burst covers the fighter it lands on. A global gain and a cap
// on what one card can add (fight.gd sets them per tier; 1 and no cap on the low tier: as before).
global uniform float cq_fx_gain;
global uniform float cq_fx_cap;
#ifdef FID29
// fid29 combat (build 29, mid and high only: fx.gd compiles this file with FID29 defined there; the low tier's
// shaders are the build 28 text, FID29 undefined). Effects frame the fighter they land on instead of burying it:
//   shield  the struck fighter's head and chest (world points, set per hit by fx.gd; sh_head.w = the body's half
//           width in metres, 0 = no shield) make a screen ellipse round the head and chest: a card fades to
//           shield_floor inside 0.6 of it and is untouched outside it
//   ground  a card fades out over its lowest 0.3 m above the paving (world height, no depth read): no hard line
//           where a burst crosses the ground (flat decals, billboard 0, are exempt)
//   cap     no card adds more than min(cq_fx_cap, 0.85) of white, with its hue kept (the build 28 cap clipped each
//           channel, which turned a saturated burst white)
uniform vec4 sh_head = vec4(0.0);
uniform vec3 sh_chest = vec3(0.0);
uniform float shield_floor = 0.2;
uniform float ground_y = 0.0;
varying vec2 v_sh;
varying float v_gh;
varying float v_cap;
#endif

void vertex() {
	vec3 sx = MODEL_MATRIX[0].xyz;
	vec3 sy = MODEL_MATRIX[1].xyz;
	if (billboard == 1) {
		float c = cos(spin);
		float s = sin(spin);
		vec3 r = INV_VIEW_MATRIX[0].xyz * c + INV_VIEW_MATRIX[1].xyz * s;
		vec3 u = -INV_VIEW_MATRIX[0].xyz * s + INV_VIEW_MATRIX[1].xyz * c;
		MODELVIEW_MATRIX = VIEW_MATRIX * mat4(vec4(r * length(sx), 0.0), vec4(u * length(sy), 0.0), vec4(INV_VIEW_MATRIX[2].xyz, 0.0), MODEL_MATRIX[3]);
	} else if (billboard == 2) {
		vec3 axis = normalize(sy);
		vec3 to_cam = normalize(INV_VIEW_MATRIX[3].xyz - MODEL_MATRIX[3].xyz);
		vec3 side = normalize(cross(axis, to_cam));
		MODELVIEW_MATRIX = VIEW_MATRIX * mat4(vec4(side * length(sx), 0.0), vec4(sy, 0.0), vec4(to_cam, 0.0), MODEL_MATRIX[3]);
	} else if (billboard == 3) {
		vec3 r = normalize(vec3(INV_VIEW_MATRIX[0].x, 0.0, INV_VIEW_MATRIX[0].z));
		MODELVIEW_MATRIX = VIEW_MATRIX * mat4(vec4(r * length(sx), 0.0), vec4(0.0, length(sy), 0.0, 0.0), vec4(cross(r, vec3(0.0, 1.0, 0.0)), 0.0), MODEL_MATRIX[3]);
	}
#ifdef FID29
	// per vertex (a billboard quad is flat in screen space: the varyings interpolate exactly)
	vec4 vp = MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	vec4 cp = PROJECTION_MATRIX * vp;
	// the ellipse in this frame's clip space (the same projection, whatever the target's orientation)
	vec4 ph = PROJECTION_MATRIX * (VIEW_MATRIX * vec4(sh_head.xyz, 1.0));
	vec4 pc = PROJECTION_MATRIX * (VIEW_MATRIX * vec4(sh_chest, 1.0));
	vec2 nh = ph.xy / ph.w;
	vec2 nc = pc.xy / pc.w;
	vec2 rad = vec2(abs(PROJECTION_MATRIX[0][0]), abs(PROJECTION_MATRIX[1][1])) * sh_head.w / max(pc.w, 0.01);
	rad.y += abs(nh.y - nc.y) * 0.5;
	v_sh = sh_head.w > 0.0 ? (cp.xy / cp.w - (nh + nc) * 0.5) / max(rad, vec2(0.001)) : vec2(9.0);
	v_gh = billboard == 0 ? 1.0 : ((INV_VIEW_MATRIX * vp).y - ground_y) / 0.3;
	// the cap as a ceiling on coverage: the card's brightest channel times coverage never passes it
	vec3 c0 = mix((tint * COLOR).rgb, vec3(1.0), hot) * intensity * cq_fx_gain;
	v_cap = min(cq_fx_cap, 0.85) / max(max(c0.r, c0.g), max(c0.b, 0.001));
#endif
}

void fragment() {
	vec2 c = vec2(mod(cell, 4.0), floor(cell / 4.0));
	float a = texture(atlas, (c + clamp(UV, vec2(0.004), vec2(0.996))) * 0.25).a;
	vec4 col = tint * COLOR;
	float al = a * col.a;
	vec3 rgb = mix(col.rgb, vec3(1.0, 0.99, 0.95), hot * smoothstep(0.5, 1.0, a)) * intensity;
#ifdef FID29
	al = min(al * clamp(dot(v_sh, v_sh) * 1.5625 - 0.5625, shield_floor, 1.0) * clamp(v_gh, 0.0, 1.0), v_cap);
	ALBEDO = rgb * al * cq_fx_gain;
#else
	ALBEDO = min(rgb * al * cq_fx_gain, vec3(cq_fx_cap));
#endif
	ALPHA = al * (1.0 - add) * min(cq_fx_gain, 1.0);
}
