// build 29 (fid29-street): the real street ground on the mid and high tiers (place.gd ground_mat on look.real with
// look.fid_street; street_real.gd for the medallion and the arena's floor). The low tier keeps world_ground.gdshader.
//  - CC0 photo maps at full strength (art/world/real/ground, tools/world/make_world_art.py --profile real): albedo,
//    normal, packed ORM (R AO, G roughness, B height), tiled in WORLD space (tile_m metres a repeat), anisotropic
//    samplers by hint (the project's anisotropic level is not changed);
//  - lit like the fighters (char_real): GGX key light with Schlick Fresnel, and the street's light from
//    LookReal.env_for(time) (six ambient colours, ALU; Karis' environment BRDF), so ground and fighters agree;
//  - geometric specular anti-aliasing (Tokuyoshi and Kaplanyan: kernel variance 0.15, threshold 0.2): no highlight
//    shimmer on the joints at grazing angles;
//  - a world-space detail normal at 1.5 m (whiteout blend), fading out between 8 and 25 m (high only);
//  - wear decals (gum, cracks, patches, leaves, stains) from one atlas, scattered by a hashed world grid in the shader
//    (no Decal node: the Compatibility renderer has none), never within 1.2 m of the fight's centre, only within 25 m;
//  - damp patches at dusk and night (damp_k): darker, smooth, the street's cube reflected with Fresnel;
//  - the place's baked shade (far bake, and the 48 m near-fight bake when inside it): R cast shadow, G contact AO;
//  - capsule occlusion under the fighters (ground_occluders.gd): 6 capsules per fighter for up to 4 fighters,
//    cosine-weighted, evaluated only within 2.5 m of a fighter.
// Texture reads per pixel: within 25 m albedo, normal, ORM, wear, bake, decal (+ detail on high); a damp pixel reads the
// cube instead of the detail (high) or instead of the decal (mid): 6 on mid, 7 on high; beyond 25 m albedo, ORM,
// wear, bake: 4.
shader_type spatial;
render_mode cull_back, ambient_light_disabled;
// @CUTOUT (street_real.gd makes a variant with "#define CUTOUT" here: the medallion's disc, the worn road paint)

uniform sampler2D albedo_tex : source_color, hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float tile_m = 4.0;
uniform float uv_mode = 0.0;          // 0 world xz, 1 world (x+z, y) for vertical faces (kerb fronts), 2 the mesh UV
uniform vec3 tint : source_color = vec3(1.0);
uniform float use_vcol = 0.0;         // 1: the vertex colour multiplies the albedo (markings)
uniform float expose = 1.0;           // the paving's exposure (look "ground_k"), as build 28's ground
uniform float normal_k = 1.0;
uniform float rough_mul = 1.0;
uniform sampler2D mask_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float mask_tile = 1.0;        // CUTOUT with use_vcol: the paint wear mask (world, mask_tile m)

uniform sampler2D wear_tex : hint_default_black, filter_linear_mipmap, repeat_enable;
uniform float wear_tile = 24.0;
uniform float grime_k = 0.3;
uniform float macro_k = 0.12;

uniform sampler2D detail_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float detail_on = 0.0;        // high tier
uniform float detail_tile = 1.5;
uniform float detail_k = 0.6;

uniform sampler2D decal_tex : source_color, hint_default_transparent, filter_linear_mipmap, repeat_disable;
uniform float decal_on = 0.0;
uniform float decal_cell = 1.7;       // metres per grid cell (at most one decal a cell)
uniform float decal_prob = 0.3;
uniform vec4 decal_pick_a = vec4(0.0, 1.0, 2.0, 3.0);   // 8 atlas cells (0..15) this surface picks from
uniform vec4 decal_pick_b = vec4(8.0, 9.0, 12.0, 13.0);
uniform vec2 fight_c = vec2(0.0, 0.0);
uniform float fight_keep = 1.2;        // no decal within this of the fight's centre

uniform sampler2D bake_tex : filter_linear;
uniform vec4 bake_rect = vec4(-210.0, -280.0, 420.0, 420.0);
uniform sampler2D near_tex : filter_linear;
uniform vec4 near_rect = vec4(-24.0, -20.0, 48.0, 48.0);
uniform float near_on = 0.0;
uniform float bake_on = 0.0;
uniform float shadow_k = 0.72;
uniform vec3 ao_col : source_color = vec3(0.42, 0.416, 0.478);
uniform float ao_alpha = 0.55;

uniform samplerCube env_cube : filter_linear_mipmap;
uniform float env_scale = 4.0;
uniform float env_lods = 5.0;
uniform float env_on = 0.0;
uniform vec3 amb_cube[6];
uniform float amb_amount = 1.0;
uniform float spec_k = 1.0;
uniform float damp_k = 0.0;           // 1 at dusk and night

uniform vec4 cap_a[24];               // capsule end a (world xyz), w radius
uniform vec4 cap_b[24];               // capsule end b (world xyz)
uniform vec4 cap_f[4];                // fighter i: ground centre xyz, w 1 = present
uniform float cap_k = 0.0;            // 0 = capsule occlusion off (look fid_street_cap false)

varying vec3 wpos;
varying float vshadow;

// normal maps are imported as two-channel (RG) compressed textures: z is rebuilt
vec3 unpack_n(vec4 t) {
	vec2 xy = t.rg * 2.0 - 1.0;
	return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
}

vec3 to_lin(vec3 c) {
	return pow(max(c, vec3(0.0)), vec3(2.2));
}

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

vec3 hash32(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	p3 += dot(p3, p3.yxz + 33.33);
	return fract((p3.xxy + p3.yzz) * p3.zyx);
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

// cosine-weighted occlusion of the fighters' capsules seen from a ground point (each as a sphere at its nearest point)
float caps_occ(vec3 p, vec3 n) {
	float occ = 1.0;
	for (int f = 0; f < 4; f++) {
		vec4 fc = cap_f[f];
		if (fc.w < 0.5) {
			continue;
		}
		float dd = length(p.xz - fc.xz);
		if (dd > 2.5) {
			continue;
		}
		float fade = 1.0 - smoothstep(1.8, 2.5, dd);
		for (int c = 0; c < 6; c++) {
			int i = f * 6 + c;
			vec3 a = cap_a[i].xyz;
			vec3 ab = cap_b[i].xyz - a;
			float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
			vec3 d = a + ab * t - p;
			float l2 = max(dot(d, d), 1e-4);
			float r = cap_a[i].w;
			float o = clamp(dot(n, d) * inversesqrt(l2), 0.0, 1.0) * min(r * r / l2, 1.0);
			occ *= 1.0 - o * cap_k * fade;
		}
	}
	return occ;
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	// vertical faces (kerb fronts, basin walls) tile along the face and up it, without the normal map
	vec3 gw = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
	bool vert = uv_mode < 0.5 && abs(gw.y) < 0.5;
	vec2 p = uv_mode > 1.5 ? UV : (uv_mode > 0.5 ? vec2(wpos.x + wpos.z, wpos.y) / tile_m : wpos.xz / tile_m);
	if (vert) {
		p = vec2(dot(wpos.xz, vec2(-gw.z, gw.x)), wpos.y) / tile_m;
	}
	float vdist = length(wpos - CAMERA_POSITION_WORLD);
	bool is_near = vdist < 25.0;
	vec4 alb = texture(albedo_tex, p);
	vec3 a = alb.rgb * tint;
	a *= mix(vec3(1.0), to_lin(COLOR.rgb), use_vcol);
#ifdef CUTOUT
	float cover = alb.a * (use_vcol > 0.5 ? texture(mask_tex, wpos.xz / mask_tile).r : 1.0);
	ALPHA = cover;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
#endif
	vec3 orm = texture(orm_tex, p).rgb;
	float rough = orm.g * rough_mul;
	float occ = orm.r;
	vec3 w = texture(wear_tex, wpos.xz / wear_tile).rgb;
	a *= 1.0 - w.r * grime_k * 0.3;
	a *= 1.0 + (w.b - 0.5) * macro_k * 2.0;
	// the tangent frame: flat ground (+x tangent), kerb fronts, or the mesh's own (the medallion is a flat plane too)
	vec3 nt = vec3(0.0, 0.0, 1.0);
	float nfade = 1.0 - smoothstep(15.0, 25.0, vdist);
	// damp: water lies in the low spots first (ORM height), only at dusk and night
	float wet = 0.0;
	if (damp_k > 0.0) {
		wet = smoothstep(0.35, 0.75, w.g * 1.25 - orm.b * 0.45) * damp_k;
	}
	vec2 dpx = dFdx(wpos.xz);
	vec2 dpy = dFdy(wpos.xz);
	if (is_near) {
		vec2 gx = dFdx(p);
		vec2 gy = dFdy(p);
		if (normal_k > 0.0) {     // the worn road paint has no relief of its own: no normal read
			nt = unpack_n(textureGrad(normal_tex, p, gx, gy));
			nt.xy *= normal_k * nfade;
		}
		if (detail_on > 0.5 && wet < 0.05) {
			vec2 dp = wpos.xz / detail_tile;
			vec3 dn = unpack_n(textureGrad(detail_tex, dp, dpx / detail_tile, dpy / detail_tile));
			float dk = detail_k * (1.0 - smoothstep(8.0, 25.0, vdist));
			// whiteout blend
			nt = vec3(nt.xy + dn.xy * dk, nt.z * dn.z);
		}
		// mid has no detail layer: a damp pixel reads the cube instead of the decal atlas (6 reads either way)
		if (decal_on > 0.5 && uv_mode < 0.5 && !vert && (detail_on > 0.5 || wet < 0.05)) {
			vec2 q = wpos.xz / decal_cell;
			vec2 cid = floor(q);
			vec3 h = hash32(cid + vec2(17.0, 3.0));
			vec2 cc = (cid + 0.5) * decal_cell;
			if (h.x < decal_prob && length(cc - fight_c) > fight_keep + decal_cell * 0.5) {
				float k = floor(h.y * 7.999);
				float cell = k < 4.0 ? decal_pick_a[int(k)] : decal_pick_b[int(k) - 4];
				float ang = h.z * 6.2832;
				float sc = mix(0.55, 0.95, fract(h.y * 13.7));
				mat2 rot = mat2(vec2(cos(ang), sin(ang)), vec2(-sin(ang), cos(ang)));
				vec2 l = rot * (fract(q) - 0.5) / sc + 0.5;
				if (l.x > 0.0 && l.y > 0.0 && l.x < 1.0 && l.y < 1.0) {
					vec2 org = vec2(mod(cell, 4.0), floor(cell / 4.0));
					vec2 duv = (org + l) * 0.25;
					vec2 g1 = rot * dpx / (decal_cell * sc) * 0.25;
					vec2 g2 = rot * dpy / (decal_cell * sc) * 0.25;
					vec4 dc = textureGrad(decal_tex, duv, g1, g2);
					float da = dc.a * (1.0 - smoothstep(15.0, 25.0, vdist));
					a = mix(a, dc.rgb, da);
					// gum and patches are smoother; leaves and stains rougher; a decal flattens the joints under it
					float dr = cell < 3.5 ? 0.55 : (cell < 7.5 ? 0.8 : (cell < 9.5 ? 0.9 : (cell < 11.5 ? 0.45 : 0.75)));
					rough = mix(rough, dr, da);
					nt.xy *= 1.0 - da * 0.7;
					occ = mix(occ, 1.0, da * 0.5);
				}
			}
		}
	}
	// the baked shade: the near-fight bake (finer) where it covers, else the place's bake
	float sh = 0.0;
	if (bake_on > 0.5) {
		vec2 nuv = (wpos.xz - near_rect.xy) / near_rect.zw;
		vec2 b;
		bool in_near = near_on > 0.5 && nuv.x > 0.01 && nuv.y > 0.01 && nuv.x < 0.99 && nuv.y < 0.99;
		vec2 buv = in_near ? nuv : (wpos.xz - bake_rect.xy) / bake_rect.zw;
		if (buv.x > 0.0 && buv.y > 0.0 && buv.x < 1.0 && buv.y < 1.0) {
			// one bake read: a branch, not a select (a select samples both)
			if (in_near) {
				b = texture(near_tex, buv).rg;
			} else {
				b = texture(bake_tex, buv).rg;
			}
			sh = clamp(b.r, 0.0, 1.0);
			a *= mix(vec3(1.0), ao_col, clamp(b.g, 0.0, 1.0) * ao_alpha);
		}
	}
	vshadow = sh;
	// damp: darker, smoother, the joints filled (flatter normal)
	a *= mix(1.0, 0.55, wet);
	rough = mix(rough, 0.08, wet);
	nt.xy *= 1.0 - wet * 0.85;
	nt = normalize(nt);
	// tangent space to view space: on flat ground x = world x, the bitangent world z; kerb fronts and the mesh UV use
	// the mesh's own TANGENT/BINORMAL
	vec3 n;
	if (uv_mode > 1.5) {
		n = normalize(TANGENT * nt.x + BINORMAL * nt.y + NORMAL * nt.z);
	} else if (uv_mode > 0.5 || vert) {
		n = NORMAL;   // vertical faces built without tangents: the albedo and roughness only
	} else {
		// world-space tiling on flat ground: image x = world +x, image y (down) = world +z, so a GL normal's +Y
		// points along world -z
		vec3 tw = (VIEW_MATRIX * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
		vec3 bw = (VIEW_MATRIX * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
		n = normalize(tw * nt.x - bw * nt.y + NORMAL * nt.z);
	}
	// geometric specular AA (Tokuyoshi and Kaplanyan 2019)
	vec3 dndu = dFdx(n);
	vec3 dndv = dFdy(n);
	float variance = 0.15 * (dot(dndu, dndu) + dot(dndv, dndv));
	float kern = min(2.0 * variance, 0.2);
	float al = rough * rough;
	float a2 = clamp(al * al + kern, 0.0, 1.0);
	float r_aa = sqrt(sqrt(a2));
	NORMAL = n;
	ALBEDO = a * expose;
	ROUGHNESS = r_aa;
	SPECULAR = 0.5;
	// the street's light: diffuse from the six ambient colours, the reflection by Karis' environment BRDF
	vec3 nw = (INV_VIEW_MATRIX * vec4(n, 0.0)).xyz;
	vec3 vw = (INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz;
	float ao = occ;
	if (cap_k > 0.0) {
		ao *= caps_occ(wpos, nw);
	}
	float nov = clamp(dot(n, VIEW), 1e-4, 1.0);
	vec3 amb = amb_at(nw) * amb_amount;
	vec3 f0 = vec3(mix(0.04, 0.02, wet));
	vec2 ab = env_brdf(r_aa, nov);
	ab.y *= mix(1.0 - 0.75 * r_aa, 1.0, wet);
	vec3 rw = reflect(-vw, nw);
	vec3 refl = amb_at(normalize(mix(rw, nw, r_aa * r_aa))) * amb_amount;
	if (env_on > 0.5 && wet > 0.05 && is_near) {
		vec3 e = textureLod(env_cube, rw, r_aa * env_lods).rgb;
		refl = mix(refl, e * e * env_scale, wet);
	}
	float so = clamp(pow(nov + ao, exp2(-16.0 * r_aa - 1.0)) - 1.0 + ao, 0.0, 1.0);
	// the baked shadow takes the sun away (light()) and dims the sky's reflection a little; the sky's diffuse light
	// stays, as on build 28 (shade reads as daylit shade, not night)
	EMISSION = ALBEDO * amb * ao + refl * (f0 * ab.x + ab.y) * so * spec_k * (1.0 - sh * 0.35);
}

void light() {
	float ndl = clamp(dot(NORMAL, LIGHT), 0.0, 1.0);
	float sk = (1.0 - vshadow * shadow_k);
	vec3 h = normalize(LIGHT + VIEW);
	float ndh = clamp(dot(NORMAL, h), 0.0, 1.0);
	float ndv = max(dot(NORMAL, VIEW), 0.0001);
	float ldh = clamp(dot(LIGHT, h), 0.0, 1.0);
	float al = ROUGHNESS * ROUGHNESS;
	float a2 = al * al;
	float dn = ndh * ndh * (a2 - 1.0) + 1.0;
	float d = a2 / (PI * dn * dn);
	float vis = 0.5 / max(mix(2.0 * ndl * ndv, ndl + ndv, al), 0.0001);
	float f = 0.04 + 0.96 * pow(1.0 - ldh, 5.0);
	DIFFUSE_LIGHT += ndl * ATTENUATION * LIGHT_COLOR / PI * sk * (1.0 - f);
	SPECULAR_LIGHT += LIGHT_COLOR * ATTENUATION * (ndl * d * vis * f * spec_k * sk);
}
