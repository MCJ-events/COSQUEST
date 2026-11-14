// look-world: moving water (fountain pools, ponds, rivers): two scrolling normal maps, a shallow/deep
// tint (art direction 2.2), and the sky in a fresnel reflection, so it reads as water in daylight.
// build 29 (fid29-street): real_k 1 (mid and high, place.gd water_mat with look.fid_street) adds a depth tint from the
// basin's edge (vertex alpha: 0 at the stone rim, 1 a metre in), the street's cube reflected with Fresnel
// (LookReal.env_for) and the stone rim's dark wet band. real_k 0 (the default, low) runs build 28's code unchanged.
shader_type spatial;
render_mode cull_back, shadows_disabled;

uniform sampler2D water_n : hint_normal, filter_linear_mipmap, repeat_enable;
uniform vec3 shallow : source_color = vec3(0.243, 0.612, 0.769);
uniform vec3 deep : source_color = vec3(0.165, 0.435, 0.62);
uniform vec3 sky_upper : source_color = vec3(0.525, 0.682, 0.878);
uniform vec3 sky_horizon : source_color = vec3(0.949, 0.867, 0.761);
uniform float tile_m = 5.0;
uniform float speed = 1.0;
uniform float real_k = 0.0;
uniform vec3 real_shallow : source_color = vec3(0.30, 0.33, 0.30);
uniform vec3 real_deep : source_color = vec3(0.045, 0.07, 0.07);
uniform samplerCube env_cube : filter_linear_mipmap;
uniform float env_scale = 4.0;
uniform float env_lods = 5.0;
uniform float env_on = 0.0;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 uv = wpos.xz / tile_m;
	vec3 n1 = texture(water_n, uv + TIME * speed * vec2(0.031, 0.017)).rgb;
	vec3 n2 = texture(water_n, uv * 1.73 - TIME * speed * vec2(0.019, 0.034)).rgb;
	if (real_k > 0.5) {
		NORMAL_MAP = normalize(n1 + n2 - 1.0) * 0.5 + 0.5;
		NORMAL_MAP_DEPTH = 0.45;
		float depth = clamp(COLOR.a, 0.0, 1.0);
		float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 5.0);
		vec3 body = mix(real_shallow, real_deep, smoothstep(0.0, 1.0, depth));
		vec3 nw = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
		vec3 vw = (INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz;
		vec3 rw = reflect(-vw, nw);
		vec3 refl = mix(sky_horizon, sky_upper, clamp(rw.y, 0.0, 1.0));
		if (env_on > 0.5) {
			vec3 e = textureLod(env_cube, rw, 0.6).rgb;
			refl = e * e * env_scale;
		}
		ALBEDO = body;
		ROUGHNESS = 0.05;
		SPECULAR = 0.5;
		EMISSION = refl * fres * 0.9 + body * 0.15;
	} else {
		NORMAL_MAP = normalize(n1 + n2 - 1.0) * 0.5 + 0.5;
		NORMAL_MAP_DEPTH = 0.7;
		float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
		ALBEDO = mix(deep, shallow, 0.45 + 0.25 * (n1.r - 0.5));
		ROUGHNESS = 0.12;
		SPECULAR = 0.6;
		EMISSION = mix(sky_horizon, sky_upper, 0.6) * (0.08 + 0.5 * fres);
	}
}
