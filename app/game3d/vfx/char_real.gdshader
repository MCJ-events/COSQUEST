// Fighter material, the "real" look (realism 11 Nov 2026, docs/game3d/LOOK.md "The real look").
// char_lit.gdshader stays as it is for the low tier. This one shades a fighter the way the street is lit:
//  - the model's own maps: base colour, packed roughness and metal, a tangent-space normal map and an
//    emissive map when the file has them;
//  - the key light through a physically based light(): GGX specular, Schlick Fresnel, and a Lambert
//    diffuse that gives up what the specular took (energy conserving);
//  - the street's own light for everything else: a small prefiltered cube of the street at this time of
//    day (one textureLod read: metal and skin pick up the sky, the walls and the paving) and six ambient
//    colours measured from the same cube (ALU only), instead of the flat ambient plus a hemisphere guess;
//  - skin (the Forge skin mask, or a colour guess when there is none): the diffuse wraps round the
//    terminator, red furthest, so the shadow edge is warm instead of grey; a second, tighter specular lobe
//    gives the soft sheen. Both are scaled by the surface's own colour, so deep skin stays deep;
//  - the rim and the hit flash of char_lit, the rim quieter (it was a self-glow on dark characters);
//  - the cloth-off-legs vertex code of char_lit, unchanged (secondary_motion.gd feeds it).
// Cost over char_lit: one cube read, one or two 2D reads (normal, skin mask), about 60 ALU.
shader_type spatial;
render_mode cull_back, depth_draw_opaque, ambient_light_disabled;

uniform sampler2D albedo_tex : source_color, hint_default_white, filter_linear_mipmap, repeat_enable;
uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform vec4 orm_channel_r = vec4(0.0, 1.0, 0.0, 0.0);   // which channel holds roughness (glTF: green)
uniform vec4 orm_channel_m = vec4(0.0, 0.0, 1.0, 0.0);   // which channel holds metallic (glTF: blue)
uniform float roughness = 1.0;
uniform float metallic = 0.0;
uniform float specular = 0.5;
uniform vec3 uv1_scale = vec3(1.0);
uniform vec3 uv1_offset = vec3(0.0);
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap, repeat_enable;
uniform float normal_amount = 0.0;         // 0 = no normal map (or the mesh has no tangents)
uniform sampler2D emission_tex : source_color, hint_default_black, filter_linear_mipmap, repeat_enable;
uniform vec3 emission = vec3(0.0);
uniform float ao_amount = 0.0;             // the model's occlusion (the packed map's red channel), when it has one

// skin: 0 = none, 1 = the mask texture (red channel), 2 = a guess from the base colour
uniform int skin_mode = 0;
uniform sampler2D skin_tex : hint_default_black, filter_linear_mipmap, repeat_enable;
uniform float skin_amount = 1.0;
uniform vec3 skin_wrap = vec3(0.22, 0.08, 0.03);   // how far the light wraps past the terminator, per channel
uniform float skin_lobe2 = 0.18;           // the share of the second, tighter specular lobe (0 = one lobe)
// hair (round 2): the Forge hair mask (red). Hair is never skin, keeps a rough base, and takes a strand
// highlight that runs across the strands (they hang down the head) instead of the round GGX one
uniform bool hair_on = false;
uniform sampler2D hair_tex : hint_default_black, filter_linear_mipmap, repeat_enable;
uniform float skin_back = 0.22;            // light through thin skin at the silhouette when the key is behind (ears, fingers)

// the street's light at this time of day (look_real.gd)
uniform samplerCube env_cube : filter_linear_mipmap;
uniform float env_scale = 4.0;             // the cube stores sqrt(radiance / env_scale)
uniform float env_lods = 5.0;              // the last mip (roughness 1)
uniform float env_spec = 1.0;              // 0 = no reflections (look "ibl": false)
uniform vec3 amb_cube[6];                  // +x -x +y -y +z -z: the cube's diffuse light, in the street's units
uniform float amb_amount = 1.0;

// round 3
uniform float recv_shadow = 1.0;           // 0 = the fighter does not take the shadow map's shadow (it still casts): at
                                           // the close camera the map's steps drew a jagged patch across faces
uniform float key_sat = 1.0;               // the key's colour on the fighter: under 1 pulls it towards white (dusk's orange)
// round 4 (replaces round 3's frontal fill)
uniform vec2 expo = vec2(1.0, 0.0);        // exposure by the surface's own brightness. x: gain on near-black cloth, fading to 1
                                           // by a luminance of 0.3 (a black suit has to read at night). y: above 0.3 the gain is
                                           // (0.3 / luminance) ^ y (a cream coat must not outshine the paving)
uniform vec3 kick_a_dir = vec3(0.0, 1.0, 0.0);   // world: towards the sky-side kicker (behind the fighter, camera's right, high)
uniform vec3 kick_a_col = vec3(0.0);
uniform vec3 kick_b_dir = vec3(0.0, 1.0, 0.0);   // world: towards the lamp-side kicker (behind, camera's left, low, warm)
uniform vec3 kick_b_col = vec3(0.0);
uniform vec3 bounce_col = vec3(0.0);       // the sunlit paving's light on surfaces that face down
uniform float occ_k = 0.0;                 // the occlusion stand-in: creases (screen-space curvature) and the ground under the body
uniform vec3 key_dir = vec3(0.65, -0.56, 0.51);
uniform vec3 rim_key : source_color = vec3(1.0, 0.8, 0.55);
uniform vec3 rim_team : source_color = vec3(0.5, 0.85, 1.0);
uniform float rim_amount = 0.0;
uniform float team_amount = 0.35;
uniform float flash = 0.0;
uniform float glow = 0.0;
uniform int debug_view = 0;                // review only: 1 grey albedo, 2 mirror, 3 skin weight, 4 normals

// cq 016: cloth off the legs (char_lit.gdshader has the notes). Off: cloth_bind0 = 100000.
uniform int cloth_bind0 = 100000;
uniform vec4 la0; uniform vec4 lb0;
uniform vec4 la1; uniform vec4 lb1;
uniform vec4 la2; uniform vec4 lb2;
uniform vec4 la3; uniform vec4 lb3;

varying float v_skin;
varying float v_hair;

vec3 cap_push(vec3 p, vec4 a, vec4 b) {
	vec3 ab = b.xyz - a.xyz;
	float u = clamp(dot(p - a.xyz, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
	vec3 c = a.xyz + ab * u;
	vec3 d = p - c;
	float dn = length(d);
	return (dn < a.w && dn > 1e-5) ? c + d * (a.w / dn) : p;
}

void vertex() {
	UV = UV * uv1_scale.xy + uv1_offset.xy;
	if (cloth_bind0 < 100000) {
		ivec4 bi = ivec4(BONE_INDICES);
		float cw = (bi.x >= cloth_bind0 ? BONE_WEIGHTS.x : 0.0) + (bi.y >= cloth_bind0 ? BONE_WEIGHTS.y : 0.0)
			+ (bi.z >= cloth_bind0 ? BONE_WEIGHTS.z : 0.0) + (bi.w >= cloth_bind0 ? BONE_WEIGHTS.w : 0.0);
		if (cw > 0.02) {
			vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
			vec3 p = cap_push(cap_push(cap_push(cap_push(w, la0, lb0), la1, lb1), la2, lb2), la3, lb3);
			if (p != w) {
				VERTEX = (inverse(MODEL_MATRIX) * vec4(mix(w, p, smoothstep(0.02, 0.5, cw)), 1.0)).xyz;
			}
		}
	}
}

// Skin from the base colour alone (linear): red over green over blue in the ratios skin keeps from deep
// to light tones (g/r 0.36 to 0.66, b/r 0.16 to 0.48). Brown leather and wood pass too; gold, grey steel,
// white and saturated cloth do not. Used at part strength (fighter.gd SKIN_GUESS).
float skin_guess(vec3 c) {
	float mx = max(c.r, 0.001);
	float g = c.g / mx;
	float b = c.b / mx;
	float w = smoothstep(0.3, 0.4, g) * (1.0 - smoothstep(0.62, 0.72, g))
		* smoothstep(0.1, 0.18, b) * (1.0 - smoothstep(0.44, 0.54, b)) * step(b, g);
	return w * smoothstep(0.012, 0.04, c.r);
}

// Karis' mobile fit of the split-sum environment BRDF: scale and bias for F0.
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

void fragment() {
	vec4 a = texture(albedo_tex, UV) * albedo;
	vec3 base = a.rgb;
	vec4 orm = texture(orm_tex, UV);
	float rough = clamp(dot(orm, orm_channel_r) * roughness, 0.06, 1.0);
	float metal = clamp(dot(orm, orm_channel_m) * metallic, 0.0, 1.0);
	float skin = 0.0;
	float skin_area = 0.0;     // where skin is, before the colour check (beard and brow texels fail the check)
	if (skin_mode == 1) {
		// the mask, checked against the colour: Forge's mask also marks red and brown armour as skin
		// (measured on the Kade test character), and armour must not get the skin's wrap
		skin_area = texture(skin_tex, UV).r;
		skin = skin_area * mix(0.1, 1.0, skin_guess(base));
	} else if (skin_mode == 2) {
		skin = skin_guess(base);
		skin_area = skin;
	}
	skin *= skin_amount * (1.0 - metal);
	float hair = 0.0;
	if (hair_on) {
		hair = texture(hair_tex, UV).r;
		skin *= 1.0 - hair;
		rough = mix(rough, max(rough, 0.5), hair);
		metal *= 1.0 - hair;
	}
	v_hair = hair;
	if (debug_view == 1) {
		base = vec3(0.5);     // one mid-grey for every fighter: the light alone (measure.py, the grey test)
		metal = 0.0;
		rough = 0.9;
		skin = 0.0;
	} else if (debug_view == 2) {
		base = vec3(0.95);
		metal = 1.0;
		rough = 0.06;
		skin = 0.0;
	}
	v_skin = skin;
	vec3 n = NORMAL;
	if (normal_amount > 0.0) {
		// round 3: the baked normal map is noisy on faces (the lift's voxel ripple), and across the key's
		// terminator that noise drew a jagged dark patch down one side of a face in close shots (measured:
		// it is there with the shadow map off and gone with the normal map off). On skin the map is read four
		// mips down and at 0.15 of its strength (two mips and 0.3 still left a smaller patch): the face's form
		// comes from the mesh.
		// round 4: at full strength again, three mips down. The asset track's meshes have hard 30 degree edges
		// that only the normal map smooths, so a weak map left their faces faceted; the mip level alone takes
		// the noise out.
		vec3 t = texture(normal_tex, UV, 3.0 * skin_area).xyz * 2.0 - 1.0;
		t.xy *= normal_amount;
		t.z = sqrt(max(1.0 - dot(t.xy, t.xy), 0.0));
		n = normalize(TANGENT * t.x + BINORMAL * t.y + NORMAL * t.z);
		NORMAL = n;
	}
	float ao = mix(1.0, orm.r, ao_amount);
	if (occ_k > 0.0) {
		// round 4: no ambient occlusion pass in this renderer. Two cheap stand-ins on the ambient and the
		// reflections: creases (where the mesh's normal converges across neighbouring pixels: armpits, the
		// neck under the chin, between the legs, folds) and the ground's own shade on what faces down near it.
		vec3 gn = NORMAL;
		float den = dot(dFdx(VERTEX), dFdx(VERTEX)) + dot(dFdy(VERTEX), dFdy(VERTEX)) + 0.000001;
		float curv = (dot(dFdx(gn), dFdx(VERTEX)) + dot(dFdy(gn), dFdy(VERTEX))) / den;
		float crease = clamp(1.0 + curv * 0.012, 0.5, 1.0);
		float wy = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).y;
		float gnd = mix(1.0, mix(0.55, 1.0, smoothstep(0.0, 0.5, wy)), clamp(0.7 - (INV_VIEW_MATRIX * vec4(gn, 0.0)).y, 0.0, 1.0));
		ao *= mix(1.0, crease * gnd, occ_k);
	}
	float nov = clamp(dot(n, VIEW), 0.0, 1.0);
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(n, 0.0)).xyz);
	vec3 vw = normalize((INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz);
	vec3 f0 = mix(vec3(mix(0.16 * specular * specular, 0.028, skin)), base, metal);
	// the street's diffuse light: sky above, walls at the sides, the paving's bounce below
	float blum = dot(base, vec3(0.2126, 0.7152, 0.0722));
	vec3 lit = base * mix(expo.x, 1.0, smoothstep(0.03, 0.3, blum)) * pow(0.3 / max(blum, 0.3), expo.y);
	vec3 amb = amb_at(nw) * amb_amount * ao;
	// a little of the bounce under the skin's surface: the shade side of skin is not dead
	vec3 diffuse_amb = lit * (1.0 - metal) * amb * (1.0 + skin * vec3(0.06, 0.01, 0.0));
	// the street reflected: sharper on metal and wet-looking skin, a blur on cloth
	vec3 spec_amb = vec3(0.0);
	if (env_spec > 0.0) {
		vec3 r = reflect(-vw, nw);
		// a rough surface reflects what its normal faces more than the mirror direction
		r = normalize(mix(r, nw, rough * rough));
		vec3 e = textureLod(env_cube, r, rough * env_lods).rgb;
		e = e * e * env_scale;
		vec2 ab = env_brdf(rough, nov);
		// round 2: a rough, non-metal surface at a grazing angle mirrored the bright sky as a grey haze
		// (the top of dark hair): its edge reflection fades with roughness
		ab.y *= mix(1.0 - 0.75 * rough, 1.0, metal);
		// what the body itself hides: no bright sky in a crease or under the chin
		float so = clamp(pow(nov + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao, 0.0, 1.0);
		// single scattering loses energy on rough metal (it goes dark): give back the multiple-scatter share
		vec3 ms = 1.0 + f0 * (1.0 / max(ab.x + ab.y, 0.2) - 1.0);
		spec_amb = e * (f0 * ab.x + ab.y) * ms * so * env_spec;
	}
	float f = 1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float f3 = f * f * f;
	float fr = f * f * sqrt(f);
	vec3 to_key = normalize((VIEW_MATRIX * vec4(-key_dir, 0.0)).xyz);
	float sunward = smoothstep(-0.15, 0.55, dot(NORMAL, to_key));
	// the rim: the key light at a grazing angle, where every surface reflects (Fresnel), so it is mostly
	// the light's colour and a little of the surface's; the team tint on the far side stays a hint
	vec3 rim = mix(rim_team * team_amount, rim_key, sunward) * fr * rim_amount * mix(vec3(1.0), base * 1.6 + 0.04, 0.7);
	vec3 hit = vec3(1.0, 0.86, 0.62) * flash * (0.06 + 1.15 * fr);
	float body = smoothstep(0.35, 1.0, glow);
	vec3 gl = vec3(1.0, 0.97, 0.92) * glow * (0.6 * body + 0.75 * pow(f, 1.5))
		+ vec3(1.0, 0.85, 0.6) * glow * f3 * 0.6;
	base = mix(base, vec3(1.0, 0.9, 0.78), 0.2 * clamp(flash, 0.0, 1.0));
	ALBEDO = mix(lit, base, metal);     // the key's diffuse goes through the exposure-corrected colour too
	ROUGHNESS = rough;
	METALLIC = metal;
	SPECULAR = specular;
	// round 4: light with a direction instead of the frontal fill. Two kickers from behind the fighter (the
	// sky on one side, the street's lamps on the other at dusk and night) light the edges turned away from
	// the camera and give dark cloth a sheen along its outline; the sunlit paving bounces up under chins,
	// arms and capes. All three go through the surface's (exposure-corrected) colour.
	vec3 kick = vec3(0.0);
	float edge = 0.25 + 0.75 * (1.0 - nov) * (1.0 - nov);
	if (kick_a_col.r + kick_a_col.g + kick_a_col.b > 0.0) {
		float wa = pow(clamp(dot(nw, kick_a_dir), 0.0, 1.0), 1.2) * edge;
		float sa = pow(clamp(dot(nw, normalize(kick_a_dir + vw)), 0.0, 1.0), mix(48.0, 6.0, rough)) * mix(0.5, 0.08, rough);
		kick += kick_a_col * ao * (lit * (1.0 - metal) * wa + mix(vec3(0.6), base, metal) * sa);
	}
	if (kick_b_col.r + kick_b_col.g + kick_b_col.b > 0.0) {
		float wb = pow(clamp(dot(nw, kick_b_dir), 0.0, 1.0), 1.2) * edge;
		float sb = pow(clamp(dot(nw, normalize(kick_b_dir + vw)), 0.0, 1.0), mix(48.0, 6.0, rough)) * mix(0.5, 0.08, rough);
		kick += kick_b_col * ao * (lit * (1.0 - metal) * wb + mix(vec3(0.6), base, metal) * sb);
	}
	float under = clamp(0.5 - 0.5 * nw.y, 0.0, 1.0);
	kick += bounce_col * lit * (1.0 - metal) * under * under * ao;
	EMISSION = diffuse_amb + spec_amb + kick + rim + hit + gl + texture(emission_tex, UV).rgb * emission;
	if (debug_view == 3) {
		ALBEDO = vec3(0.0);
		EMISSION = vec3(skin, skin * 0.4, v_hair);
	} else if (debug_view == 4) {
		ALBEDO = vec3(0.0);
		EMISSION = nw * 0.5 + 0.5;
	}
}

float d_ggx(float ndh, float a2) {
	float d = ndh * ndh * (a2 - 1.0) + 1.0;
	return a2 / (PI * d * d);
}

void light() {
	float ndl = dot(NORMAL, LIGHT);
	float cndl = clamp(ndl, 0.0, 1.0);
	vec3 h = normalize(VIEW + LIGHT);
	float ndh = clamp(dot(NORMAL, h), 0.0, 1.0);
	float ndv = max(dot(NORMAL, VIEW), 0.0001);
	float ldh = clamp(dot(LIGHT, h), 0.0, 1.0);
	float fres = pow(1.0 - ldh, 5.0);
	vec3 f0 = mix(vec3(mix(0.16 * SPECULAR_AMOUNT * SPECULAR_AMOUNT, 0.028, v_skin)), ALBEDO, METALLIC);
	vec3 fr = f0 + (1.0 - f0) * fres;
	float att = LIGHT_IS_DIRECTIONAL ? mix(1.0, ATTENUATION, recv_shadow) : ATTENUATION;
	vec3 lcol = mix(vec3(dot(LIGHT_COLOR, vec3(0.2126, 0.7152, 0.0722))), LIGHT_COLOR, LIGHT_IS_DIRECTIONAL ? key_sat : 1.0);
	// diffuse: Lambert, wrapped past the terminator on skin (red furthest), less what the specular took.
	// The engine multiplies it by the surface's colour and by (1 - metal).
	vec3 w = skin_wrap * v_skin;
	vec3 d = clamp((vec3(ndl) + w) / (1.0 + w), 0.0, 1.0);
	DIFFUSE_LIGHT += lcol * att * d * (1.0 - fr) * (1.0 / PI);
	if (v_skin > 0.0 && skin_back > 0.0) {
		// no thickness map: only where the body is thin from here (the silhouette) and the light is behind it
		float thin = (1.0 - ndv) * (1.0 - ndv);
		float behind = pow(clamp(dot(VIEW, -LIGHT), 0.0, 1.0), 3.0);
		DIFFUSE_LIGHT += lcol * att * vec3(1.0, 0.3, 0.14) * (thin * behind * skin_back * v_skin / PI);
	}
	// specular: GGX, with a second tighter lobe on skin (the sheen over the soft one)
	float al = ROUGHNESS * ROUGHNESS;
	float a2 = al * al;
	float dd = d_ggx(ndh, a2);
	if (skin_lobe2 > 0.0 && v_skin > 0.0) {
		float al2 = al * 0.42;
		dd = mix(dd, d_ggx(ndh, al2 * al2), skin_lobe2 * v_skin);
	}
	float vis = 0.5 / max(mix(2.0 * cndl * ndv, cndl + ndv, al), 0.0001);
	vec2 ab = env_brdf(ROUGHNESS, ndv);
	vec3 ms = 1.0 + f0 * (1.0 / max(ab.x + ab.y, 0.2) - 1.0);
	vec3 spec = cndl * dd * vis * fr * ms;
	if (v_hair > 0.0) {
		// Kajiya-Kay on a solid sculpt: the strands run down the head (the view's up, laid on the surface)
		vec3 up = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
		vec3 t = normalize(up - NORMAL * dot(NORMAL, up) + NORMAL * 0.08);
		float th = dot(t, h);
		float strand = pow(sqrt(max(1.0 - th * th, 0.0)), 48.0);
		spec = mix(spec, vec3(strand * 0.22 * smoothstep(-0.1, 0.4, ndl)) * mix(vec3(1.0), ALBEDO * 3.0 + 0.1, 0.6), v_hair);
	}
	SPECULAR_LIGHT += lcol * att * spec;
}
