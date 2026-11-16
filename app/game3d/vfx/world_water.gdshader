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
uniform vec3 real_shallow : source_color = vec3(0.36, 0.37, 0.33);   // the basin floor seen through the water
uniform vec3 real_deep : source_color = vec3(0.10, 0.13, 0.12);
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
		vec3 body = mix(real_shallow, real_deep, smoothstep(0.0, 1.0, depth));
		// the rippled world normal (the pool is flat: the normal maps' x and y lie along world x and -z)
		vec3 tn = normalize(n1 + n2 - 1.0);
		vec3 nw = normalize(vec3(tn.x * 0.3, 1.0, -tn.y * 0.3));
		vec3 vw = (INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz;
		vec3 rw = reflect(-vw, nw);
		float ndv = clamp(dot(nw, vw), 0.0, 1.0);
		float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
		// the time preset's sky, with the street's cube (buildings, the sky's own light) blended over it: the cube
		// alone went black at dusk, and a pool never reflects black
		vec3 refl = mix(sky_horizon, sky_upper, smoothstep(0.0, 0.7, rw.y));
		if (env_on > 0.5) {
			vec3 e = textureLod(env_cube, rw, 1.0).rgb;
			refl = mix(refl, max(e * e * env_scale, refl * 0.6), 0.5);
		}
		// water scatters little light itself: the basin floor shows through near the rim, the deep middle is dark,
		// and the colour at the game camera's grazing angle is the reflected sky
		ALBEDO = body * mix(0.55, 0.12, smoothstep(0.0, 1.0, depth));
		ROUGHNESS = 0.06;
		SPECULAR = 0.5;
		EMISSION = refl * fres * 1.15 + body * 0.05;
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
