// build 29 (fid29-street): building facades on the mid and high tiers (place.gd _facade_mat on look.real with
// look.fid_street). The same layout and UVs as world_facade.gdshader (low), on the real trim sheets
// (art/world/real/trims, tools/world/trim_sheets.py make_real): photo brick and render at full strength, no baked light.
//  - albedo: brick sheets keep the photo's colour (a little lightness per building); the stone sheet is tinted by the
//    building's wall colour where its mask (ORM blue) says wall, as on low;
//  - lit like the real ground: the key light through the engine's GGX, the street's six ambient colours from
//    LookReal.env_for(time) for the ambient (ALU), glass reflecting the sky by Karis' environment BRDF;
//  - rain streaks under the sills (ambientCG Leaking012A) running down the wall below each window;
//  - on high, a masonry micro-detail normal at 256 px/m on walls within 15 m of the camera;
//  - on high, the window reveals and sills (place.gd _reveals) carry their own shade in the vertex alpha (the walls
//    keep 1.0): the reveal's cheeks and soffit sit in the opening's shade, the surround and sill a little under the
//    wall, so they read as depth, not as bright strips stuck on (the facade casts no shadows);
//  - glass: the street's sky reflected at glass_refl + 0.32 Fresnel (as build 28's glass), at least the physical
//    Fresnel; the photo glass is dark (0.05), so the 4 % of a physical pane alone read as black holes.
// Texture reads: albedo, ORM, normal, streaks (4); +1 detail on high within 15 m.
shader_type spatial;
render_mode cull_back, shadows_disabled, ambient_light_disabled;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D orm_tex : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D leak_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform sampler2D detail_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float detail_on = 0.0;
uniform float detail_k = 0.7;
uniform float normal_k = 1.0;
uniform float tint_k = 0.0;            // 1: the wall mask takes the building's colour (stone, render); 0: photo brick
uniform vec4 sill_a = vec4(0.42, 1.58, 2.42, 3.58);   // the sheet's windows across x (metres in the 8 m repeat)
uniform vec4 sill_b = vec4(4.77, 7.23, -1.0, -1.0);
uniform float sill_y = 3.45;           // metres from the sheet top where the bay row's sills sit
uniform float leak_k = 0.35;
uniform vec3 window_col : source_color = vec3(1.0, 0.851, 0.627);
uniform float windows_k_mul = 0.15;
uniform float lit_share = 0.45;
uniform vec3 sky_upper : source_color = vec3(0.525, 0.682, 0.878);
uniform vec3 sky_horizon : source_color = vec3(0.949, 0.867, 0.761);
uniform float ao_height = 2.0;
uniform float ao_min = 0.6;
uniform vec3 amb_cube[6];
uniform float amb_amount = 1.0;
uniform float glass_refl = 0.22;       // the glass's sky reflection head-on (build 28's glass: 0.06 + albedo)

varying float wy;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

vec3 to_lin(vec3 c) {
	return pow(max(c, vec3(0.0)), vec3(2.2));
}

vec2 env_brdf(float r, float nov) {
	const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
	const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
	vec4 q = r * c0 + c1;
	float a004 = min(q.x * q.x, exp2(-9.28 * nov)) * q.x + q.y;
	return vec2(-1.04, 1.04) * a004 + q.zw;
}

vec3 amb_at(vec3 nw) {
	vec3 n2 = nw * nw;
	return n2.x * (nw.x >= 0.0 ? amb_cube[0] : amb_cube[1])
		+ n2.y * (nw.y >= 0.0 ? amb_cube[2] : amb_cube[3])
		+ n2.z * (nw.z >= 0.0 ? amb_cube[4] : amb_cube[5]);
}

float in_span(float x, vec2 s) {
	return s.x < 0.0 ? 0.0 : smoothstep(s.x - 0.02, s.x + 0.08, x) * (1.0 - smoothstep(s.y - 0.08, s.y + 0.02, x));
}

void vertex() {
	wy = (MODEL_MATRIX * vec4(VERTEX, 1.0)).y;
}

void fragment() {
	vec3 base = texture(albedo_tex, UV).rgb;
	vec4 orm = texture(orm_tex, UV);
	float lshade = 0.93 + 0.14 * fract(UV2.x * 7.13);                // per building, brick lightness
	vec3 wall = base * mix(vec3(lshade), to_lin(COLOR.rgb) / 0.604, tint_k);
	vec3 a = mix(base, wall, orm.b) * COLOR.a;   // reveal and sill faces: their shade (walls 1.0)
	float glass = smoothstep(0.35, 0.75, orm.a);
	// rain streaks: under each window's sill, down through the string course into the bay below
	float xm = fract(UV.x) * 8.0;
	float ym = UV.y * 10.0;
	float under = max(max(in_span(xm, sill_a.xy), in_span(xm, sill_a.zw)), max(in_span(xm, sill_b.xy), in_span(xm, sill_b.zw)));
	float band = (step(sill_y, ym) * step(ym, 4.5) * (1.0 - smoothstep(sill_y, 4.5, ym) * 0.4))
		+ step(1.0, ym) * step(ym, 1.6) * (1.0 - smoothstep(1.0, 1.6, ym));
	float lk = texture(leak_tex, vec2(UV.x * 3.0 + UV2.x, ym / 3.2)).r;
	float streak = (1.0 - lk) * under * band * leak_k * (1.0 - glass);
	a *= 1.0 - streak;
	float ao = mix(ao_min, 1.0, smoothstep(0.0, ao_height, wy)) * orm.r;
	float cell = floor(UV.x * 4.0);
	float hsh = hash12(vec2(UV2.x * 97.0 + cell, UV2.y * 13.0 + cell * 0.37));
	float lit = step(hsh, lit_share) * mix(0.45, 1.0, fract(hsh * 7.31));
	vec3 nm = texture(normal_tex, UV).rgb;
	float vd = length(VERTEX);
	if (detail_on > 0.5 && vd < 15.0) {
		vec2 dxy = texture(detail_tex, UV * vec2(4.0, 5.0)).rg * 2.0 - 1.0;
		vec2 bxy = nm.rg * 2.0 - 1.0;
		vec3 dn = vec3(dxy, sqrt(max(1.0 - dot(dxy, dxy), 0.0)));
		vec3 bn = vec3(bxy, sqrt(max(1.0 - dot(bxy, bxy), 0.0)));
		float dk = detail_k * orm.b * (1.0 - glass) * (1.0 - smoothstep(9.0, 15.0, vd));
		nm = normalize(vec3(bn.xy + dn.xy * dk, bn.z * mix(1.0, dn.z, dk))) * 0.5 + 0.5;
	}
	ALBEDO = a;
	ROUGHNESS = mix(orm.g, 0.06, glass) + streak * 0.1;
	NORMAL_MAP = nm;
	NORMAL_MAP_DEPTH = normal_k;
	// the street's light: ambient (six colours) and the glass's reflection of the sky and street
	vec3 nw = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
	vec3 vw = (INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz;
	float nov = clamp(dot(NORMAL, VIEW), 1e-4, 1.0);
	vec3 rw = reflect(-vw, nw);
	vec3 sky = mix(sky_horizon, sky_upper, clamp(rw.y * 1.5 + 0.3, 0.0, 1.0));
	vec3 refl = mix(amb_at(rw) * amb_amount, sky * 0.9, smoothstep(-0.05, 0.25, rw.y));
	vec2 ab = env_brdf(ROUGHNESS, nov);
	ab.y *= mix(1.0 - 0.75 * ROUGHNESS, 1.0, glass);
	vec3 spec = refl * (0.04 * ab.x + ab.y) * mix(ao, 1.0, glass);
	float fres = pow(1.0 - nov, 3.0);
	// panes mirror the upper sky (the blue, as build 28's glass), not the warm horizon
	vec3 gsky = mix(refl, sky_upper * 0.9, 0.6);
	spec = mix(spec, max(spec, gsky * (glass_refl + 0.32 * fres)), glass);
	EMISSION = a * amb_at(nw) * amb_amount * ao + spec * (1.0 - lit * min(windows_k_mul, 1.0) * glass)
		+ glass * window_col * lit * windows_k_mul;
}
