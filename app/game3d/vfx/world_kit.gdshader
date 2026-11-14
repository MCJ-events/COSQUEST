// look-world: the kit (props, roof clutter, trees, landmarks; world_props.gd, world_landmarks.gd). Their
// meshes carry their colour and baked AO in the vertex colour; this adds a painterly detail texture
// (props noise, landmark stone, canopy breakup) projected in world space (triplanar, no UVs), the
// hemisphere ambient, wind sway on foliage (vertex alpha = sway weight), wing flaps on birds, and an
// emission for lamp heads (only lit at dusk). One shader, a material per surface class.
// fid29 (dressing): real_k = 1 (mid and high, place_dress.gd) swaps the painterly detail for an unstylised one
// (art/world/props/kit_real, ambientCG-derived), keeps the engine's GGX with a roughness per class widened by the
// normal's screen variance (specular anti-aliasing), and adds the street's reflection from the LookReal cube
// (read only) through the mobile split-sum BRDF. real_k = 0 (the default, the low tier) runs the original code.
shader_type spatial;
render_mode cull_back, shadows_disabled;

uniform sampler2D detail_tex : filter_linear_mipmap, repeat_enable;
uniform float detail_tile = 2.0;
uniform float detail_k = 0.35;       // 0: vertex colour only; 1: the texture fully multiplies (mean 0.5 -> x1)
uniform float detail_mean = 0.5;
uniform vec3 tint : source_color = vec3(1.0);
uniform float rough = 0.7;
uniform float sway = 0.0;            // metres of sway at a weight of 1
uniform float flap = 0.0;            // bird wing flap amplitude (radians-ish)
uniform vec3 emit_col : source_color = vec3(1.0, 0.8, 0.5);
uniform float emit_k = 0.0;
uniform float emit_from_vcol = 0.0;
uniform float cull_two = 0.0;
uniform float lift = 0.1;            // a little bounced light, so shade sides never go black (bronze, granite)
uniform vec3 hemi_up : source_color = vec3(0.54, 0.6, 0.98);
uniform vec3 hemi_horizon : source_color = vec3(0.8, 0.74, 0.9);
uniform vec3 hemi_ground : source_color = vec3(0.6, 0.48, 0.5);
uniform float hemi_energy = 0.0;
uniform float real_k = 0.0;          // fid29: 0 = the original look (low), 1 = the real look (mid, high)
uniform sampler2D real_detail : filter_linear_mipmap_anisotropic, repeat_enable;
uniform float real_mean = 0.5;
uniform float real_dk = 0.5;         // how much of the real detail multiplies the vertex colour
uniform float real_rough = 0.7;
uniform float real_metal = 0.0;
uniform float real_spec = 0.5;
uniform samplerCube env_cube : filter_linear_mipmap;
uniform float env_scale = 4.0;
uniform float env_lods = 5.0;
uniform float env_spec = 0.0;        // 0: no cube read (no LookReal cube for this time of day)

varying vec3 wpos;
varying vec3 wnrm;

vec3 hemi_extra(vec3 nw) {
	vec3 c = nw.y > 0.0 ? mix(hemi_horizon, hemi_up, nw.y) : mix(hemi_horizon, hemi_ground, -nw.y);
	return (c - hemi_up) * hemi_energy;
}

vec3 to_lin(vec3 c) {
	return pow(max(c, vec3(0.0)), vec3(2.2));   // vertex colours are authored in sRGB
}

void vertex() {
	vec3 ip = MODEL_MATRIX[3].xyz;
	float ph = ip.x * 0.37 + ip.z * 0.21;
	if (sway > 0.0) {
		float w = COLOR.a;
		VERTEX.x += sin(TIME * 1.3 + ph) * w * sway;
		VERTEX.z += cos(TIME * 1.07 + ph * 1.3) * w * sway * 0.6;
		VERTEX.y += sin(TIME * 2.3 + ph + VERTEX.x) * w * sway * 0.15;
	}
	if (flap > 0.0) {
		float w = COLOR.a;
		VERTEX.y += sin(TIME * 14.0 + ph * 5.0) * w * flap * abs(VERTEX.x);
	}
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

vec2 env_brdf(float r, float nov) {
	const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
	const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
	vec4 q = r * c0 + c1;
	float a004 = min(q.x * q.x, exp2(-9.28 * nov)) * q.x + q.y;
	return vec2(-1.04, 1.04) * a004 + q.zw;
}

void fragment() {
	if (real_k > 0.0) {
		vec3 bw = pow(abs(wnrm), vec3(4.0));
		bw /= (bw.x + bw.y + bw.z + 1e-4);
		float d = texture(real_detail, wpos.yz / detail_tile).r * bw.x
			+ texture(real_detail, wpos.xz / detail_tile).r * bw.y
			+ texture(real_detail, wpos.xy / detail_tile).r * bw.z;
		float m = mix(1.0, d / real_mean, real_dk);
		vec3 alb = to_lin(COLOR.rgb) * tint * m;
		// specular AA (Tokuyoshi and Kaplanyan): widen the lobe by the normal's change across the pixel
		vec3 dn = fwidth(NORMAL);
		float var = min(dot(dn, dn) * 0.5, 0.18);
		float r = clamp(real_rough * (0.85 + 0.3 * d), 0.04, 1.0);
		r = sqrt(sqrt(clamp(r * r * r * r + var, 0.0, 1.0)));
		ALBEDO = alb;
		ROUGHNESS = r;
		METALLIC = real_metal;
		SPECULAR = real_spec;
		vec3 nw = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
		vec3 em = alb * (hemi_extra(nw) + vec3(lift)) + mix(emit_col, to_lin(COLOR.rgb), emit_from_vcol) * emit_k;
		if (env_spec > 0.0) {
			vec3 vw = (INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz;
			float nov = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
			vec3 rd = normalize(mix(reflect(-vw, nw), nw, r * r));
			vec3 e = textureLod(env_cube, rd, r * env_lods).rgb;
			e = e * e * env_scale;
			vec2 ab = env_brdf(r, nov);
			vec3 f0 = mix(vec3(0.08 * real_spec), alb, real_metal);
			ab.y *= mix(1.0 - 0.75 * r, 1.0, real_metal);
			em += e * (f0 * ab.x + ab.y) * env_spec * m;
		}
		EMISSION = em;
	} else {
		vec3 bw = pow(abs(wnrm), vec3(4.0));
		bw /= (bw.x + bw.y + bw.z + 1e-4);
		float d = texture(detail_tex, wpos.yz / detail_tile).r * bw.x
			+ texture(detail_tex, wpos.xz / detail_tile).r * bw.y
			+ texture(detail_tex, wpos.xy / detail_tile).r * bw.z;
		float m = mix(1.0, d / detail_mean, detail_k);
		ALBEDO = to_lin(COLOR.rgb) * tint * m;
		ROUGHNESS = rough;
		vec3 nw = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
		EMISSION = ALBEDO * (hemi_extra(nw) + vec3(lift)) + mix(emit_col, to_lin(COLOR.rgb), emit_from_vcol) * emit_k;
	}
}
