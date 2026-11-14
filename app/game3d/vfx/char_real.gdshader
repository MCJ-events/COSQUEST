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
//
// fid29 charshade (14 Nov 2026, build 29 "character materials", docs/game3d/fid29/charshade.md): with cs_on (fighter.gd,
// look "fid_charshade", mid and high) every surface shades as what it is. Off (cs_on false, the default) this file draws
// exactly build 28's fighter:
//  - a material-ID mask per hero (art/char/masks, tools/char/matid.py) in the skin mask's sampler: R skin, G metal,
//    B leather, A cloth sheen; what is left is synthetic. Skin from the mask (no colour guess: leather is not skin),
//    metal only where the mask says metal (the lift's metal flag made Imani's cape bronze), roughness kept inside each
//    class's range (leather 0.45 to 0.65, cotton 0.7 to 0.9, bare metal 0.15 to 0.35);
//  - cloth: a sheen lobe (Charlie distribution, Neubelt visibility, as Filament's cloth) in place of GGX and of the rim;
//    leather keeps GGX at its own roughness;
//  - geometric specular anti-aliasing (Tokuyoshi and Kaplanyan; variance 0.15, threshold 0.2) and the normal map's own
//    mip variance (Toksvig) folded into roughness, so highlights stop sparkling;
//  - skin: a warm tint in the shadow map's penumbra (when the fighter takes the shadow, recv_shadow > 0), and its
//    specular damped in cavities;
//  - eyes (the hybrid head's eye corner of the UVs): no skin wrap, a wet roughness, the iris shifted by parallax, a
//    live catchlight from the face fill's direction (the painted one taken out), shade under the upper lid;
//  - hair cards: the strand direction from the card's own V axis (BINORMAL), two shifted lobes (Scheuermann), darker
//    towards the root, and alpha to coverage on the MSAA every tier runs (fighter.gd's "cs" cut variant);
//  - high tier only (#define CS_HIGH, fighter.gd): tiling detail normals for cloth and leather (ambientCG CC0, one 1K
//    sheet of four 512 tiles, about 5 cm a tile) and a roughness break-up on metal (ambientCG CC0), whiteout blended
//    and faded with the normal_fade footprint rule.
// Cost with cs_on, mid: no new texture read (the mask is the skin mask's read), about 35 ALU on the body; high: two more
// texture reads on cloth, leather and metal. Measured in docs/game3d/fid29/charshade.md.
shader_type spatial;
render_mode cull_back, depth_draw_opaque, ambient_light_disabled;
// CS_DEFINES (fighter.gd inserts #define CS_HIGH here for the high tier's hero bodies)

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
uniform float hair_all = 0.0;              // 1: the whole surface is hair (a separate hair material: fringe shells)
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
uniform int debug_view = 0;
// round 5 (13 Nov, faces): a soft fill from the camera's side for faces in close shots, a skin-only toning of the key's
// colour, softer specular on skin, and the detail normal fading out where it would only shimmer or draw dots
uniform vec3 face_fill_col = vec3(0.0);   // 0 = off. fight.gd raises it in the intro beat and the victory shot, a little at fight distance
uniform vec3 face_fill_dir = vec3(0.0, 0.3, 1.0);   // world: towards the fill (from the camera, above, a little to its left)
uniform float face_fill_body = 0.35;      // the share of the fill the rest of the fighter takes (skin takes all of it)
uniform float skin_key_desat = 0.0;       // how far the key's colour is pulled towards white on skin (golden hour's orange)
uniform float skin_rough_min = 0.0;       // skin's specular never sharper than this roughness (a wet sheen read as plastic)
uniform float normal_fade = 0.0;
uniform float skin_wide = 0.0;             // skinlook-28: 1 on a fitted head: the colour check accepts every skin tone
uniform float skin_gain = 0.0;             // skinlook-28: > 0 = skin's exposure gain, the same for every tone (fighter.gd SKIN_GAIN)
uniform vec3 skin_wb = vec3(1.0);         // skin's colour balance under this time of day's light and grade (fighter.gd SKIN_WB)          // > 0: the normal map fades as one screen pixel covers more texels than this                // review only: 1 grey albedo, 2 mirror, 3 skin weight, 4 normals

// cq 016: cloth off the legs (char_lit.gdshader has the notes). Off: cloth_bind0 = 100000.
uniform int cloth_bind0 = 100000;
uniform vec4 la0; uniform vec4 lb0;
uniform vec4 la1; uniform vec4 lb1;
uniform vec4 la2; uniform vec4 lb2;
uniform vec4 la3; uniform vec4 lb3;

// fid29 charshade (see the header). All off unless cs_on.
uniform bool cs_on = false;
uniform int cs_matid = 0;                  // 1: skin_tex is the hero's material-ID mask (RGBA: skin, metal, leather, cloth sheen)
uniform vec2 cs_rough_leather = vec2(0.45, 0.65);
uniform vec2 cs_rough_cloth = vec2(0.70, 0.90);
uniform vec2 cs_rough_metal = vec2(0.15, 0.35);
uniform vec2 cs_knee = vec2(0.0);          // leather, cloth: the linear luminance above which painted light is soft-clipped (0 = off)
uniform float cs_sheen = 1.0;              // the sheen lobe on cloth (0 = cloth keeps GGX)
uniform vec2 cs_sheen_k = vec2(1.653, 0.8445);   // the sheen lobe at perceptual roughness 0.55 (a = 0.3025): exponent 1 / 2a, norm (2 + 1/a) / 2 pi
uniform float cs_aa_var = 0.15;            // geometric specular AA: variance scale and threshold
uniform float cs_aa_thr = 0.2;
uniform float cs_toksvig = 1.0;            // the normal map's mip variance folded into roughness
uniform float cs_grain = 0.06;             // leather's sub-pixel grain as roughness (alpha squared added; high sets 0, its detail map does it)
uniform vec3 cs_penumbra = vec3(1.0, 0.42, 0.28);  // skin in the shadow map's penumbra: the red goes furthest
uniform float cs_cavity = 0.6;             // skin's specular damped in creases and occlusion
uniform int cs_eye = 0;                    // 1: a hybrid head (eyes in the UV corner, deploy/hybrid/hybrid_head.py EYE)
uniform float cs_eye_corner = 0.17;
uniform vec4 cs_iris_a = vec4(0.0);        // iris centre (UV) and radius of each eyeball island; w unused
uniform vec4 cs_iris_b = vec4(0.0);
uniform vec3 cs_iris_col = vec3(0.04, 0.025, 0.015);   // linear: what the painted catchlight is replaced with
uniform float cs_parallax = 0.03;          // iris depth, in units of the eye corner (0.02 to 0.04)
uniform float cs_eye_rough = 0.06;
uniform vec2 cs_catch = vec2(2.5, 0.32);   // the face fill's catchlight: strength (x the fill), size in iris radii
uniform float cs_catch_off = 0.9;           // how far the catchlight sits off the iris centre, per unit of half-vector tilt
uniform float cs_lid = 0.35;               // shade under the upper lid and at the corners (on top of the baked one)
uniform float cs_hair_cards = 0.0;         // 1: hair cards with strands along V (hair_cards material)
uniform vec4 cs_hair_lobes = vec4(-0.06, 0.10, 0.08, 0.04);   // primary shift, secondary shift, primary and secondary strength
uniform vec2 cs_hair_root = vec2(0.5, 1.0);   // the hair colour at the root end, at the tip (root-to-tip occlusion)
uniform float cs_hair_root_v = 1.0;        // 1: the root is at UV.y = 1 (the cards' layout), 0: at UV.y = 0
uniform vec4 cs_hair_strand = vec4(1.0);   // per card column of the atlas: 1 strands along V, 0 coils / braids (broad sheen)
#ifdef CS_HIGH
uniform sampler2D cs_detail_tex : hint_normal, filter_linear_mipmap, repeat_enable;   // 2x2 tiles: two cloth, two leather
uniform sampler2D cs_breakup_tex : hint_default_white, filter_linear_mipmap, repeat_enable;   // R scratches, G imperfections
uniform float cs_tiles = 100.0;            // detail tiles per UV unit (about 5 cm at the game's scale, tools/char/matid.py uv_per_m)
uniform vec2 cs_detail_amt = vec2(0.55, 0.45);   // cloth, leather strength
uniform vec4 cs_detail_pick = vec4(0.0, 0.0, 0.5, 0.0);   // the cloth tile's and the leather tile's corner in the sheet
uniform float cs_breakup = 1.0;
#endif

varying float v_skin;
varying float v_hair;
varying float v_sheen;
varying vec3 v_tint;       // charshade: the sheen's colour, sqrt of the surface colour (once here, not per light)
varying float v_eye;
varying float v_cav;
varying vec3 v_strand;
varying float v_shift;
varying float v_strandy;

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
	// skinlook-28 (14 Nov): on a fitted head (skin_wide 1) the upper edges move out so pale and olive skin pass too
	// (measured: a toned pale face had a skin weight of about 0.15, a deep one 1, so only deep skin took the skin
	// shading, its colour balance and its exposure); eye whites, grey and white paint still fail
	vec2 ge = mix(vec2(0.62, 0.72), vec2(0.80, 0.88), skin_wide);
	vec2 be = mix(vec2(0.44, 0.54), vec2(0.62, 0.72), skin_wide);
	float w = smoothstep(0.3, 0.4, g) * (1.0 - smoothstep(ge.x, ge.y, g))
		* smoothstep(0.1, 0.18, b) * (1.0 - smoothstep(be.x, be.y, b)) * step(b, g);
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

float d_ggx(float ndh, float a2) {
	float d = ndh * ndh * (a2 - 1.0) + 1.0;
	return a2 / (PI * d * d);
}

float d_charlie(float ndh, float al) {
	// Estevez and Kulla's "Charlie" sheen distribution (Filament's cloth)
	float inv = 1.0 / al;
	float s2 = max(1.0 - ndh * ndh, 0.0078125);
	return (2.0 + inv) * pow(s2, inv * 0.5) / (2.0 * PI);
}

void fragment() {
	v_sheen = 0.0;
	v_tint = vec3(0.0);
	v_eye = 0.0;
	v_cav = 1.0;
	v_strand = vec3(0.0);
	v_shift = 0.0;
	v_strandy = 0.0;
	vec2 uv = UV;
	float eye = 0.0;
	float iris = 0.0;
	vec4 icx = vec4(0.0);      // charshade: the nearest iris (UV centre, radius)
	vec4 duv = vec4(0.0);      // charshade: the UV's screen derivatives on the head (the catchlight's screen-to-UV frame)
	vec4 cm = vec4(0.0);       // charshade: the material-ID mask (skin, metal, leather, cloth sheen)
	if (cs_on) {
		if (cs_matid == 1) {
			cm = texture(skin_tex, UV);
		}
		if (cs_eye == 1) {
			duv = vec4(dFdx(UV), dFdy(UV));     // uniform control flow: before any per-pixel branch
			// the hybrid head keeps both eyeballs in the top-right corner of its UVs (one island each)
			float c0 = 1.0 - cs_eye_corner;
			eye = smoothstep(c0, c0 + 0.004, UV.x) * (1.0 - smoothstep(cs_eye_corner - 0.004, cs_eye_corner, UV.y));
			if (eye > 0.0) {
				vec4 ic = distance(UV, cs_iris_a.xy) < distance(UV, cs_iris_b.xy) ? cs_iris_a : cs_iris_b;
				icx = ic;
				float d = distance(UV, ic.xy) / max(ic.z, 1e-4);
				iris = (1.0 - smoothstep(0.9, 1.1, d)) * eye;
				// the iris lies behind the cornea: seen at an angle it shifts against the eyeball's surface
				vec3 vt = vec3(dot(VIEW, TANGENT), dot(VIEW, BINORMAL), dot(VIEW, NORMAL));
				uv -= vt.xy / max(vt.z, 0.35) * (cs_parallax * cs_eye_corner) * iris;
			}
		}
	}
	vec4 a = texture(albedo_tex, uv) * albedo;
	vec3 base = a.rgb;
	if (iris > 0.0) {
		// the painted catchlight (hybrid_head.py HEAD_CATCH) goes: anything in the iris brighter than an iris is the paint
		float lb = dot(base, vec3(0.2126, 0.7152, 0.0722));
		float lc = dot(cs_iris_col, vec3(0.2126, 0.7152, 0.0722));
		base = mix(base, cs_iris_col * clamp(lb / max(lc, 1e-4), 0.5, 1.4), smoothstep(lc * 2.5, lc * 6.0, lb) * iris);
	}
	vec4 orm = texture(orm_tex, UV);
	float rough = clamp(dot(orm, orm_channel_r) * roughness, 0.06, 1.0);
	float metal = clamp(dot(orm, orm_channel_m) * metallic, 0.0, 1.0);
	if (cs_on && cs_matid == 1) {
		// metal only where the mask says so: on cloth, leather and skin the lift's metal flag is the "smeared bronze"
		float rest = clamp(1.0 - cm.r - cm.b - cm.a, 0.0, 1.0);
		metal = max(metal * rest, cm.g);
		float r0 = rough;
		rough = r0 * clamp(1.0 - cm.g - cm.b - cm.a, 0.0, 1.0)
			+ cm.g * mix(cs_rough_metal.x, cs_rough_metal.y, r0)
			+ cm.b * mix(cs_rough_leather.x, cs_rough_leather.y, r0)
			+ cm.a * mix(cs_rough_cloth.x, cs_rough_cloth.y, r0);
		v_sheen = cm.a * cs_sheen;
		// the lift baked the concept's highlights into leather and cloth: above the class's own knee (its 75th percentile,
		// tools/char/matid.py) a quarter of the painted light is kept, so a jacket stops reading as lacquer
		float wk = cm.b + cm.a;
		if (wk > 0.02 && cs_knee.x + cs_knee.y > 0.0) {
			float kn = (cm.b * cs_knee.x + cm.a * cs_knee.y) / wk;
			float lb = dot(base, vec3(0.2126, 0.7152, 0.0722));
			float l2 = lb > kn ? kn + (lb - kn) * 0.25 : lb;
			base *= mix(1.0, l2 / max(lb, 1e-4), clamp(wk, 0.0, 1.0));
		}
	}
	if (eye > 0.0) {
		rough = mix(rough, cs_eye_rough, eye);
		metal *= 1.0 - eye;
	}
	float skin = 0.0;
	float skin_area = 0.0;     // where skin is, before the colour check (beard and brow texels fail the check)
	if (cs_on && cs_matid == 1) {
		// charshade: the mask already passed the classes' and the colour's skin gates (tools/char/matid.py)
		skin_area = cm.r;
		skin = cm.r;
	} else if (skin_mode == 1) {
		// the mask, checked against the colour: Forge's mask also marks red and brown armour as skin
		// (measured on the Kade test character), and armour must not get the skin's wrap
		skin_area = texture(skin_tex, UV).r;
		skin = skin_area * mix(0.1, 1.0, skin_guess(base));
	} else if (skin_mode == 2) {
		skin = skin_guess(base);
		skin_area = skin;
	}
	skin *= skin_amount * (1.0 - metal) * (1.0 - eye);
	rough = mix(rough, max(rough, skin_rough_min), clamp(skin * 1.6, 0.0, 1.0));
	base = mix(base, base * skin_wb, clamp(skin * 1.6, 0.0, 1.0));
	float hair = hair_all;
	if (hair_on || hair_all > 0.0) {
		hair = max(hair, hair_on ? texture(hair_tex, UV).r : 0.0);
		skin *= 1.0 - hair;
		rough = mix(rough, max(rough, 0.5), hair);
		metal *= 1.0 - hair;
	}
	v_hair = hair;
	if (cs_on && cs_hair_cards > 0.0) {
		// hair cards: darker towards the root (the strands under it shade it), a per-strand shift of the highlight from
		// the strand texture's own light and dark
		float tip = cs_hair_root_v > 0.5 ? 1.0 - UV.y : UV.y;
		v_strandy = cs_hair_strand[clamp(int(UV.x * 4.0), 0, 3)];
		base *= mix(1.0, mix(cs_hair_root.x, cs_hair_root.y, smoothstep(0.0, 0.7, tip)), v_strandy);
		// a strand id across the card (the strands run along V): a small random shift each
		v_shift = (fract(floor(UV.x * 384.0) * 0.6180339) - 0.5) * 0.1;
		v_strand = BINORMAL;
	}
	v_eye = eye;
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
	vec3 ngeo = NORMAL;
	float tok = 0.0;           // charshade: the normal map's lost length at this mip (Toksvig)
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
#ifdef CS_HIGH
		if (cs_on) {
			// the mip-averaged normal is shorter where the map's normals disagree: that spread is roughness (Toksvig;
			// high only: on mid the geometric term below carries the anti-aliasing)
			float ln = clamp(length(t), 0.2, 1.0);
			tok = cs_toksvig * (1.0 - ln) / ln * normal_amount;
		}
#endif
		float namt = normal_amount;
		if (normal_fade > 0.0) {
			vec2 ts = vec2(textureSize(normal_tex, 0));
			float fp = max(length(dFdx(UV * ts)), length(dFdy(UV * ts)));
			namt *= 1.0 - 0.75 * smoothstep(normal_fade, normal_fade * 4.0, fp);
		}
		t.xy *= namt;
		t.z = sqrt(max(1.0 - dot(t.xy, t.xy), 0.0));
#ifdef CS_HIGH
		// high tier: tiling cloth weave and leather grain at about 5 cm a tile, whiteout blended over the model's map,
		// faded where a screen pixel covers too many of its texels (the normal_fade rule) so it never shimmers
		float dw = cm.b + cm.a;
		if (dw > 0.02) {
			vec2 du = UV * cs_tiles;
			vec2 corner = cm.a >= cm.b ? cs_detail_pick.xy : cs_detail_pick.zw;
			vec2 tuv = corner + 0.0039 + fract(du) * 0.4922;
			vec3 dn = textureGrad(cs_detail_tex, tuv, dFdx(du) * 0.4922, dFdy(du) * 0.4922).xyz * 2.0 - 1.0;
			// the tiles are mip-mapped, so what one pixel cannot hold is averaged, never aliased: the grain fades only
			// once a pixel covers a whole patch of it (8 to 32 tile texels; at the intro beat a pixel covers about 8)
			float dfp = max(length(dFdx(du * 512.0)), length(dFdy(du * 512.0)));
			float damt0 = cm.a * cs_detail_amt.x + cm.b * cs_detail_amt.y;
			float damt = damt0 * (1.0 - smoothstep(normal_fade * 5.0, normal_fade * 21.0, dfp));
			// and the grain the pixel averaged away is roughness (Toksvig on the detail map): leather stops being a
			// smooth lacquer where its grain is smaller than a pixel
			float dl = clamp(length(dn), 0.2, 1.0);
			tok += cs_toksvig * (1.0 - dl) / dl * damt0;
			dn.xy *= damt;
			t = vec3(t.xy + dn.xy, t.z * sqrt(max(1.0 - dot(dn.xy, dn.xy), 0.0)));
		}
#endif
		n = normalize(TANGENT * t.x + BINORMAL * t.y + NORMAL * t.z);
		NORMAL = n;
	}
	if (cs_on) {
		// geometric specular anti-aliasing (Tokuyoshi and Kaplanyan 2019, as Filament): the screen-space change of the
		// mesh's own normal widens the lobe, so curved, small and far surfaces stop sparkling; plus the map's Toksvig term
		vec3 gdu = dFdx(ngeo);
		vec3 gdv = dFdy(ngeo);
		// leather's own grain below the pixel (the mid tier has no detail map: the same spread as a fixed term)
		float kern = min(2.0 * cs_aa_var * (dot(gdu, gdu) + dot(gdv, gdv)), cs_aa_thr) + min(tok, 0.25) + cm.b * cs_grain;
		float al = rough * rough;
		rough = sqrt(sqrt(clamp(al * al + kern, 0.0, 1.0)));
#ifdef CS_HIGH
		if (cm.g > 0.02) {
			// worn metal: scratches a little smoother, the rest of the surface broken up (ambientCG Scratches005,
			// SurfaceImperfections003), at the detail tiles' scale
			vec2 bu = UV * cs_tiles * 0.5;
			vec2 bk = texture(cs_breakup_tex, bu).rg;
			rough = clamp(rough + cm.g * cs_breakup * (0.18 * (bk.g - 0.5) - 0.08 * bk.r), 0.08, 1.0);
		}
#endif
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
	if (cs_on) {
		v_cav = mix(1.0, clamp(ao, 0.0, 1.0), cs_cavity);
		if (eye > 0.0) {
			// the lids shade the eyeball: most where it faces up (under the upper lid) and at the corners
			vec3 nm = normalize(transpose(mat3(MODEL_MATRIX)) * nw);
			float lid = smoothstep(0.1, 0.5, nm.y) + 0.6 * smoothstep(0.45, 0.8, abs(nm.x));
			lid = cs_lid * clamp(lid, 0.0, 1.0) * eye;
			ao *= 1.0 - lid;
			base *= 1.0 - 0.6 * lid;
		}
	}
	vec3 f0 = mix(vec3(mix(0.16 * specular * specular, 0.028, skin)), base, metal);
	// the street's diffuse light: sky above, walls at the sides, the paving's bounce below
	float blum = dot(base, vec3(0.2126, 0.7152, 0.0722));
	// round 5: hair is meant to be dark: the near-black gain (for black suits at night) turned black hair grey
	float gain = mix(mix(expo.x, 1.0, clamp(hair * 1.5, 0.0, 1.0)), 1.0, smoothstep(0.03, 0.3, blum)) * pow(0.3 / max(blum, 0.3), expo.y);
	// skinlook-28 (14 Nov): skin takes one exposure gain whatever its own tone. The gain by the surface's own brightness
	// (expo: up for near-black cloth, down for pale cloth) lifted deep skin 1.3 to 1.5 times at golden hour and up to 4
	// times at night while it held pale skin at 1 or under, so every face was pulled towards one middle tone: deep skin
	// came out lighter and, lifted, more orange than the concept (fighter.gd SKIN_GAIN, measured per time of day)
	if (skin_gain > 0.0) {
		gain = mix(gain, skin_gain, clamp(skin * 1.6, 0.0, 1.0));
	}
	vec3 lit = base * gain;
	vec3 amb = amb_at(nw) * amb_amount * ao;
	// a little of the bounce under the skin's surface: the shade side of skin is not dead
	vec3 diffuse_amb = lit * (1.0 - metal) * amb * (1.0 + skin * vec3(0.06, 0.01, 0.0));
	// the street reflected: sharper on metal and wet-looking skin, a blur on cloth
	vec3 spec_amb = vec3(0.0);
	if (v_sheen > 0.0 || v_hair > 0.0) {
		v_tint = sqrt(max(base, vec3(0.0)));
	}
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
		// the eye: one surface here, no separate cornea, so the sky mirrored over the iris greyed it; the lashes and the
		// iris's depth keep most of that off (the catchlight below stays)
		spec_amb *= 1.0 - 0.7 * iris;
		if (v_sheen > 0.0) {
			// cloth reflects no image of the street: its sheen takes the blurred light round it, strongest at grazing
			// angles (a fit of the Charlie lobe's directional albedo at roughness 0.5 to 0.6). The cube read above is
			// already the blurred one at cloth's roughness, so no second read.
			float sd = 0.09 + 0.36 * pow(1.0 - nov, 3.0);
			spec_amb = mix(spec_amb, e * v_tint * sd * so * env_spec, v_sheen);
		}
	}
	float f = 1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float f3 = f * f * f;
	float fr = f * f * sqrt(f);
	vec3 to_key = normalize((VIEW_MATRIX * vec4(-key_dir, 0.0)).xyz);
	float sunward = smoothstep(-0.15, 0.55, dot(NORMAL, to_key));
	// the rim: the key light at a grazing angle, where every surface reflects (Fresnel), so it is mostly
	// the light's colour and a little of the surface's; the team tint on the far side stays a hint
	vec3 rim = mix(rim_team * team_amount, rim_key, sunward) * fr * rim_amount * mix(vec3(1.0), base * 1.6 + 0.04, 0.7);
	// charshade: on cloth the sheen lobe is the grazing light, so it replaces the rim there (the team's tint stays readable)
	rim *= 1.0 - 0.75 * v_sheen;
	vec3 hit = vec3(1.0, 0.86, 0.62) * flash * (0.06 + 1.15 * fr);
	float body = smoothstep(0.35, 1.0, glow);
	vec3 gl = vec3(1.0, 0.97, 0.92) * glow * (0.6 * body + 0.75 * pow(f, 1.5))
		+ vec3(1.0, 0.85, 0.6) * glow * f3 * 0.6;
	base = mix(base, vec3(1.0, 0.9, 0.78), 0.2 * clamp(flash, 0.0, 1.0));
	ALBEDO = mix(lit, base, metal);     // the key's diffuse goes through the exposure-corrected colour too
	// ALPHA_HOOK (fighter.gd builds the alpha-tested variant for hair shells from this line)
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
		kick += kick_a_col * ao * (lit * (1.0 - metal) * wa + mix(vec3(0.6), base, metal) * sa * (1.0 - 0.6 * v_sheen));
	}
	if (kick_b_col.r + kick_b_col.g + kick_b_col.b > 0.0) {
		float wb = pow(clamp(dot(nw, kick_b_dir), 0.0, 1.0), 1.2) * edge;
		float sb = pow(clamp(dot(nw, normalize(kick_b_dir + vw)), 0.0, 1.0), mix(48.0, 6.0, rough)) * mix(0.5, 0.08, rough);
		kick += kick_b_col * ao * (lit * (1.0 - metal) * wb + mix(vec3(0.6), base, metal) * sb);
	}
	float under = clamp(0.5 - 0.5 * nw.y, 0.0, 1.0);
	kick += bounce_col * lit * (1.0 - metal) * under * under * ao;
	if (face_fill_col.r + face_fill_col.g + face_fill_col.b > 0.0) {
		// a large soft source: wrapped diffuse, so it opens the shade side of a face without a second terminator
		float wf = clamp((dot(nw, face_fill_dir) + 0.5) / 1.5, 0.0, 1.0);
		kick += face_fill_col * lit * (1.0 - metal) * wf * wf * ao * mix(face_fill_body, 1.0, clamp(v_skin * 1.6, 0.0, 1.0));
	}
	if (iris > 0.0 && face_fill_col.r + face_fill_col.g + face_fill_col.b > 0.0) {
		// the catchlight: the face fill is a big soft source by the camera and the cornea a small sphere in front of the
		// iris, so it mirrors the fill where the sphere's normal is halfway between the fill and the eye: a soft dot on
		// the iris, off its centre towards the fill (the half vector in the eye's own UV frame), that moves as the fill
		// and the head move. Drawn on the cornea, so from the UV before the iris's parallax.
		vec3 fv = normalize((VIEW_MATRIX * vec4(face_fill_dir, 0.0)).xyz);
		vec3 hv = normalize(fv + VIEW);
		// the half vector's tilt on the screen, carried into the head's UVs by their screen derivatives
		vec2 su = duv.xy * hv.x + duv.zw * hv.y;
		vec2 off = su / max(length(su), 1e-7) * min(length(hv.xy), 0.7) * cs_catch_off;
		float cd = distance(UV, icx.xy + off * icx.z) / max(icx.z * cs_catch.y, 1e-5);
		kick += face_fill_col * (cs_catch.x * (1.0 - smoothstep(0.45, 1.0, cd)) * iris);
	}
	EMISSION = diffuse_amb + spec_amb + kick + rim + hit + gl + texture(emission_tex, UV).rgb * emission;
	if (debug_view == 3) {
		ALBEDO = vec3(0.0);
		EMISSION = vec3(skin, skin * 0.4, v_hair);
	} else if (debug_view == 4) {
		ALBEDO = vec3(0.0);
		EMISSION = nw * 0.5 + 0.5;
	} else if (debug_view == 5) {
		// charshade review: the material classes (skin orange, metal cyan, leather red, cloth green, eye yellow, hair blue)
		ALBEDO = vec3(0.0);
		EMISSION = cm.r * vec3(1.0, 0.55, 0.2) + cm.g * vec3(0.2, 0.9, 1.0) + cm.b * vec3(0.9, 0.15, 0.15)
			+ cm.a * vec3(0.3, 0.95, 0.3) + eye * vec3(1.0, 1.0, 0.0) + iris * vec3(-0.6, -0.6, 0.6) + v_hair * vec3(0.2, 0.3, 1.0)
			+ vec3(0.12) * clamp(1.0 - cm.r - cm.g - cm.b - cm.a - eye - v_hair, 0.0, 1.0);
	}
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
	float ksat = LIGHT_IS_DIRECTIONAL ? key_sat * (1.0 - skin_key_desat * clamp(v_skin * 1.6, 0.0, 1.0)) : 1.0;
	vec3 lcol = mix(vec3(dot(LIGHT_COLOR, vec3(0.2126, 0.7152, 0.0722))), LIGHT_COLOR, ksat);
	// diffuse: Lambert, wrapped past the terminator on skin (red furthest), less what the specular took.
	// The engine multiplies it by the surface's colour and by (1 - metal).
	vec3 w = skin_wrap * v_skin;
	vec3 d = clamp((vec3(ndl) + w) / (1.0 + w), 0.0, 1.0);
	vec3 attc = vec3(att);
	if (cs_on && v_skin > 0.0 && LIGHT_IS_DIRECTIONAL && recv_shadow > 0.0) {
		// charshade: light scattered under the skin carries red past the shadow map's edge, so skin's penumbra is warm
		// (the shadow factor per channel: red falls off last). Only where the fighter takes the shadow (recv_shadow).
		float sh = ATTENUATION;
		vec3 pen = pow(vec3(sh), 1.0 / max(mix(vec3(1.0), cs_penumbra * 2.0, clamp(v_skin * 1.6, 0.0, 1.0)), vec3(0.05)));
		attc = mix(vec3(1.0), pen, recv_shadow);
	}
	DIFFUSE_LIGHT += lcol * attc * d * (1.0 - fr) * (1.0 / PI);
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
	if (cs_on) {
		if (v_sheen > 0.0) {
			// cloth: Charlie sheen with Neubelt's visibility (Filament's cloth model) instead of GGX; sheen colour from the
			// cloth's own colour (sqrt of the albedo)
			float vsh = 1.0 / (4.0 * (cndl + ndv - cndl * ndv) + 1e-4);
			float dch = pow(max(1.0 - ndh * ndh, 0.0078125), cs_sheen_k.x) * cs_sheen_k.y;
			vec3 sh = cndl * dch * vsh * v_tint;
			spec = mix(spec, sh, v_sheen);
		}
		// skin's highlight gives way in its creases and pores' shade (the cavity / occlusion term)
		spec *= mix(1.0, v_cav, clamp(v_skin * 1.6, 0.0, 1.0));
	}
	if (cs_on && cs_hair_cards > 0.0 && v_hair > 0.0) {
		// hair cards: the strands run along the card's V (BINORMAL). Two lobes (Scheuermann): a white one shifted
		// towards the root, a dimmer one in the hair's colour shifted towards the tip; per-strand jitter (v_shift)
		vec3 hs;
		if (v_strandy > 0.5) {
			vec3 tg = normalize(v_strand - NORMAL * dot(NORMAL, v_strand));
			vec3 t1 = normalize(tg + NORMAL * (cs_hair_lobes.x + v_shift));
			vec3 t2 = normalize(tg + NORMAL * (cs_hair_lobes.y + v_shift));
			float th1 = dot(t1, h);
			float th2 = dot(t2, h);
			float s1 = pow(max(1.0 - th1 * th1, 0.0), 45.0);
			float s2 = pow(max(1.0 - th2 * th2, 0.0), 11.0);
			hs = (vec3(s1 * cs_hair_lobes.z) + s2 * cs_hair_lobes.w * (ALBEDO * 3.0 + 0.05)) * smoothstep(-0.1, 0.4, ndl);
		} else {
			// coils and braids: no strand direction, a broad dim sheen (the cloth's Charlie lobe, rough: a = 0.5)
			float hvs = 1.0 / (4.0 * (cndl + ndv - cndl * ndv) + 1e-4);
			hs = cndl * max(1.0 - ndh * ndh, 0.0078125) * 0.637 * hvs * v_tint * 0.5;
		}
		spec = mix(spec, hs, v_hair);
	} else if (v_hair > 0.0) {
		// Kajiya-Kay on a solid sculpt: the strands run down the head (the view's up, laid on the surface)
		vec3 up = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
		vec3 t = normalize(up - NORMAL * dot(NORMAL, up) + NORMAL * 0.08);
		float th = dot(t, h);
		float strand = pow(sqrt(max(1.0 - th * th, 0.0)), 48.0);
		spec = mix(spec, vec3(strand * 0.22 * smoothstep(-0.1, 0.4, ndl)) * mix(vec3(1.0), ALBEDO * 3.0 + 0.1, 0.6), v_hair);
	}
	SPECULAR_LIGHT += lcol * att * spec;
}
