// fid29 (dressing): the photo-scanned street props (Poly Haven, CC0; tools/props) and the plane tree's bark on the mid
// and high tiers. One material per place for every prop: the prop atlas (albedo, OpenGL normal, AO/rough/metal),
// sampled anisotropically.
//  - the key light through GGX (Smith visibility, Schlick Fresnel, the mobile multiple-scatter fix) and Lambert,
//    the roughness widened by the normal's change across the pixel (specular anti-aliasing);
//  - the street's light at this time of day from the LookReal cube (read only): one textureLod for the reflection
//    through Karis' split-sum fit, the six ambient directions for the diffuse (no engine ambient, as char_real);
//  - the arena's hemisphere term (arena.gd set_hemi, read only) on top, so props sit in the same light as the kit;
//  - lamp bulbs (the atlas's emit_rect swatch) glow at dusk.
// Texture reads per fragment: 3 on mid (env_spec 0: no cube), 4 on high.
shader_type spatial;
render_mode cull_back, depth_draw_opaque, ambient_light_disabled;

uniform sampler2D albedo_tex : source_color, hint_default_white, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_disable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_disable;
uniform float normal_k = 1.0;
uniform float ao_k = 1.0;
uniform float albedo_k = 1.0;          // exposure match to the world's paving and walls
uniform vec4 emit_rect = vec4(0.9375, 0.75, 0.0625, 0.0625);
uniform vec3 emit_col : source_color = vec3(1.0, 0.82, 0.55);
uniform float emit_k = 0.0;

uniform samplerCube env_cube : filter_linear_mipmap;
uniform float env_scale = 4.0;
uniform float env_lods = 5.0;
uniform float env_spec = 0.0;          // 0 = no cube read (mid)
uniform vec3 amb_cube[6];
uniform float amb_amount = 1.25;       // the scans' albedo is measured, the kit's is bright: a little more fill

uniform vec3 hemi_up : source_color = vec3(0.54, 0.6, 0.98);
uniform vec3 hemi_horizon : source_color = vec3(0.8, 0.74, 0.9);
uniform vec3 hemi_ground : source_color = vec3(0.6, 0.48, 0.5);
uniform float hemi_energy = 0.0;
uniform float windows_k_mul = 1.0;     // set_hemi sets it for the facades; unused here

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

vec3 hemi_extra(vec3 nw) {
	vec3 c = nw.y > 0.0 ? mix(hemi_horizon, hemi_up, nw.y) : mix(hemi_horizon, hemi_ground, -nw.y);
	return (c - hemi_up) * hemi_energy;
}

void fragment() {
	vec3 base = texture(albedo_tex, UV).rgb * albedo_k;
	vec3 orm = texture(orm_tex, UV).rgb;
	vec3 nt = texture(normal_tex, UV).rgb * 2.0 - 1.0;
	NORMAL_MAP = mix(vec3(0.5, 0.5, 1.0), nt * 0.5 + 0.5, normal_k);
	float ao = mix(1.0, orm.r, ao_k);
	float metal = orm.b;
	// specular AA on the geometric normal (the normal map's own mips carry the rest)
	vec3 dn = fwidth(NORMAL);
	float var = min(dot(dn, dn) * 0.5, 0.18);
	float r = clamp(orm.g, 0.05, 1.0);
	r = sqrt(sqrt(clamp(r * r * r * r + var, 0.0, 1.0)));
	ALBEDO = base;
	ROUGHNESS = r;
	METALLIC = metal;
	AO = ao;
	AO_LIGHT_AFFECT = 0.0;
	// the mapped normal for the ambient and the reflection (NORMAL_MAP itself only reaches light())
	vec3 nv = normalize(TANGENT * nt.x * normal_k + BINORMAL * nt.y * normal_k + NORMAL * max(nt.z, 0.05));
	vec3 nw = (INV_VIEW_MATRIX * vec4(nv, 0.0)).xyz;
	float nov = clamp(dot(nv, VIEW), 0.0, 1.0);
	vec3 amb = amb_at(nw) * amb_amount + hemi_extra(nw);
	vec3 em = base * (1.0 - metal) * amb * ao;
	if (env_spec > 0.0) {
		vec3 vw = (INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz;
		vec3 rd = normalize(mix(reflect(-vw, nw), nw, r * r));
		vec3 e = textureLod(env_cube, rd, r * env_lods).rgb;
		e = e * e * env_scale;
		vec2 ab = env_brdf(r, nov);
		vec3 f0 = mix(vec3(0.04), base, metal);
		ab.y *= mix(1.0 - 0.75 * r, 1.0, metal);
		float so = clamp(pow(nov + ao, exp2(-16.0 * r - 1.0)) - 1.0 + ao, 0.0, 1.0);
		vec3 ms = 1.0 + f0 * (1.0 / max(ab.x + ab.y, 0.2) - 1.0);
		em += e * (f0 * ab.x + ab.y) * ms * so * env_spec;
	}
	vec2 eu = (UV - emit_rect.xy) / emit_rect.zw;
	if (emit_k > 0.0 && eu.x >= 0.0 && eu.y >= 0.0 && eu.x <= 1.0 && eu.y <= 1.0) {
		em += emit_col * emit_k;
	}
	EMISSION = em;
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
	vec3 f0 = mix(vec3(0.04), ALBEDO, METALLIC);
	vec3 fr = f0 + (1.0 - f0) * pow(1.0 - ldh, 5.0);
	DIFFUSE_LIGHT += LIGHT_COLOR * ATTENUATION * cndl * (1.0 - fr) * (1.0 / PI);
	float al = ROUGHNESS * ROUGHNESS;
	float a2 = al * al;
	float vis = 0.5 / max(mix(2.0 * cndl * ndv, cndl + ndv, al), 0.0001);
	vec2 ab = env_brdf(ROUGHNESS, ndv);
	vec3 ms = 1.0 + f0 * (1.0 / max(ab.x + ab.y, 0.2) - 1.0);
	SPECULAR_LIGHT += LIGHT_COLOR * ATTENUATION * cndl * d_ggx(ndh, a2) * vis * fr * ms;
}
