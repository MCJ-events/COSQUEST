// Fighter material (cq 015): the character's own glTF material (base colour texture x factor,
// metallic-roughness texture x factors) plus, in the same pass, the light that makes the
// fighters pop off the street as on the reference:
//  - a rim on the key light's side (warm, the low evening sun) and a fainter one on the other
//    side in the team colour (the sky side), both fresnel terms;
//  - the hit flash (cq 013's look: a white-hot core at its peak and a warm rim as it decays).
// It replaces cq 233's overlay, a second pass over every skinned vertex (cq 011 dropped the
// team rim for that cost): no extra draw call, a handful of ALU per pixel.
shader_type spatial;
render_mode cull_back, depth_draw_opaque, diffuse_burley, specular_schlick_ggx;

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

uniform vec3 key_dir = vec3(0.65, -0.56, 0.51);            // the direction the key light travels (world)
uniform vec3 rim_key : source_color = vec3(1.0, 0.8, 0.55);  // the sun's side
uniform vec3 rim_team : source_color = vec3(0.5, 0.85, 1.0); // the sky side, tinted by team
uniform float rim_amount = 0.0;                              // 0 = no rim (look "rim": false)
uniform float team_amount = 0.35;
uniform float flash = 0.0;
// cq 015: the dusk sky's hemisphere ambient over the flat sky-up ambient the environment gives
// (arena.gd SKY_*, set_hemi): walls get the lilac horizon, undersides the warm bounce. ALU only.
uniform vec3 hemi_up : source_color = vec3(0.54, 0.6, 0.98);
uniform vec3 hemi_horizon : source_color = vec3(0.8, 0.74, 0.9);
uniform vec3 hemi_ground : source_color = vec3(0.6, 0.48, 0.5);
uniform float hemi_energy = 0.0;

vec3 hemi_extra(vec3 nw) {
	vec3 c = nw.y > 0.0 ? mix(hemi_horizon, hemi_up, nw.y) : mix(hemi_horizon, hemi_ground, -nw.y);
	return (c - hemi_up) * hemi_energy;
}

void vertex() {
	UV = UV * uv1_scale.xy + uv1_offset.xy;
}

void fragment() {
	vec4 a = texture(albedo_tex, UV) * albedo;
	ALBEDO = a.rgb;
	vec4 orm = texture(orm_tex, UV);
	ROUGHNESS = dot(orm, orm_channel_r) * roughness;
	METALLIC = dot(orm, orm_channel_m) * metallic;
	SPECULAR = specular;
	float f = 1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float f3 = f * f * f;
	float fr = f * f * sqrt(f);   // the rim: a little wider than the flash's f^3 so it reads at 60 px
	// towards the key light, in view space: the rim is warm where the surface turns to the sun
	vec3 to_key = normalize((VIEW_MATRIX * vec4(-key_dir, 0.0)).xyz);
	float sunward = smoothstep(-0.15, 0.55, dot(NORMAL, to_key));
	vec3 rim = mix(rim_team * team_amount, rim_key, sunward) * fr * rim_amount;
	float body = smoothstep(0.35, 1.0, flash);
	vec3 hit = vec3(1.0, 0.97, 0.92) * flash * (0.6 * body + 0.75 * pow(f, 1.5))
		+ vec3(1.0, 0.85, 0.6) * flash * f3 * 0.6;
	vec3 nw = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
	EMISSION = rim + hit + ALBEDO * hemi_extra(nw) * (1.0 - METALLIC);
}
