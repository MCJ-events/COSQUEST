// fight-look-31 (look "fl_weapon", mid and high): a weapon in hand drawn as what its parts are. The Forge's weapons
// are low-poly kit models coloured from a small palette (one flat colour per face, no maps), so a blade, its guard and
// the grip all read as the same flat plastic. Each pixel is sorted by its palette colour:
//   steel  greys and blues: metallic, a brushed streak along the part, the street's reflection (the fighters' baked cube)
//   gold   bright yellows and oranges: gilt metal, warmer and a little rougher
//   wood   mid browns: grain and fibres, rough
//   leather dark browns and near-blacks: a fine pebbled grain, between
// The detail is art/weapons/weapon_grain.png (tools/weapons/make_grain.py, our own) mapped on the model's own axes, so no
// UVs are needed. One texture read for the palette, three for the triplanar detail, one cube read: ALU and reads a phone
// spends on a few hundred pixels.
shader_type spatial;
render_mode cull_back, depth_draw_opaque;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D grain_tex : filter_linear_mipmap, repeat_enable;
uniform float grain_scale = 3.0;         // detail tiles per metre of the model
uniform samplerCube env_cube : filter_linear_mipmap;
uniform float env_scale = 4.0;           // the cube stores sqrt(radiance / env_scale) (look_real.gd)
uniform float env_lods = 5.0;
uniform float env_k = 0.0;               // 0 = no cube (sun and ambient only)
uniform vec3 env_flat = vec3(0.35, 0.36, 0.4);   // the reflection when there is no cube: a soft street grey
uniform float steel_tint = 0.22;         // how much of the palette's hue a steel part keeps (a blue blade stays a little blue)
uniform float edge_k = 0.35;
uniform float studio_k = 0.9;            // the studio band's brightness
uniform float studio_mix = 0.55;         // how much of the reflection is the studio (the rest the street)             // the bevel stand-in: a soft bright edge where a face turns away from the camera

varying vec3 v_obj;
varying vec3 v_objn;

void vertex() {
	v_obj = VERTEX;
	v_objn = NORMAL;
}

float lum(vec3 c) {
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// triplanar detail on the model's axes; the streaks of a face run along its longest in-plane axis guess (u = the other axis)
vec4 detail(vec3 p, vec3 n) {
	vec3 w = pow(abs(n), vec3(4.0));
	w /= max(w.x + w.y + w.z, 0.0001);
	vec4 gx = texture(grain_tex, p.zy * grain_scale);
	vec4 gy = texture(grain_tex, p.xz * grain_scale);
	vec4 gz = texture(grain_tex, p.xy * grain_scale);
	return gx * w.x + gy * w.y + gz * w.z;
}

void fragment() {
	vec3 c = texture(albedo_tex, UV).rgb * albedo.rgb;
	float mx = max(c.r, max(c.g, c.b));
	float mn = min(c.r, min(c.g, c.b));
	float sat = (mx - mn) / max(mx, 0.0001);
	float l = lum(c);
	// warm = red over blue (browns, golds); the palette is linear here (source_color)
	float warm = smoothstep(1.15, 1.8, c.r / max(c.b, 0.002)) * step(c.g * 0.9, c.r + 0.001);
	float gold = warm * smoothstep(0.35, 0.55, sat) * smoothstep(0.12, 0.3, mx) * smoothstep(0.18, 0.35, c.g / max(c.r, 0.002));
	float dark = 1.0 - smoothstep(0.025, 0.07, mx);
	float leather = max(dark, warm * (1.0 - gold) * (1.0 - smoothstep(0.05, 0.11, mx)));
	float wood = warm * (1.0 - gold) * (1.0 - leather);
	float steel = clamp(1.0 - gold - wood - leather, 0.0, 1.0);
	vec4 g = detail(v_obj, normalize(v_objn));

	// steel: a neutral polished grey that keeps a little of the palette's hue, brushed
	float cl = max(l, 0.0001);
	vec3 hue = clamp(c / cl * 0.56, 0.0, 1.0);
	vec3 steel_c = mix(vec3(0.62, 0.63, 0.66), hue, steel_tint) * (0.9 + 0.2 * g.r);
	vec3 gold_c = mix(c / max(mx, 0.0001), vec3(1.0, 0.78, 0.36), 0.5) * 0.85 * (0.92 + 0.16 * g.a);
	vec3 wood_c = c * (0.62 + 0.75 * g.g);
	vec3 leather_c = max(c, vec3(0.03, 0.022, 0.018)) * (0.75 + 0.5 * g.b);

	ALBEDO = steel_c * steel + gold_c * gold + wood_c * wood + leather_c * leather;
	METALLIC = (steel + gold) * 0.85;
	ROUGHNESS = steel * (0.28 + 0.18 * g.r + 0.12 * g.a) + gold * (0.36 + 0.12 * g.a) + wood * (0.72 + 0.15 * (1.0 - g.g)) + leather * (0.55 + 0.2 * g.b);
	SPECULAR = 0.5;

	// the street in the metal: the fighters' baked reflection cube (look_real.gd env_for), else a flat grey
	vec3 nv = normalize(NORMAL);
	vec3 vv = normalize(VIEW);
	float nov = clamp(dot(nv, vv), 0.0, 1.0);
	vec3 rw = (INV_VIEW_MATRIX * vec4(reflect(-vv, nv), 0.0)).xyz;
	vec3 e = env_flat;
	if (env_k > 0.0) {
		vec3 s = textureLod(env_cube, rw, ROUGHNESS * env_lods).rgb;
		e = s * s * env_scale * env_k;
	}
	// a soft studio over the street: a bright sky band above the horizon, a dark floor below. The street cube alone is
	// mostly dark paving from a blade's height, so polished steel read as brown wood; this is what makes it read as metal
	float hy = rw.y;
	vec3 studio = mix(vec3(0.16, 0.16, 0.17), vec3(0.95, 0.97, 1.0), smoothstep(-0.12, 0.08, hy)) + vec3(0.5) * exp(-hy * hy * 60.0);
	e = mix(e, studio * studio_k, studio_mix);
	float metal = steel + gold;
	vec3 f0 = mix(vec3(0.04), ALBEDO, metal);
	vec3 fr = f0 + (max(vec3(1.0 - ROUGHNESS), f0) - f0) * pow(1.0 - nov, 5.0);
	float edge = pow(1.0 - nov, 3.0) * edge_k * metal;
	EMISSION = e * fr * (1.0 - 0.5 * ROUGHNESS) + e * edge;
}
