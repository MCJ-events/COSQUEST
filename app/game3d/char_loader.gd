extends RefCounted
## Loads a Forge character GLB at runtime with GLTFDocument + GLTFState.
## load_glb() is safe to run on a worker Thread: nothing it builds is in the tree yet.


static func clean_path(p: String) -> String:
	var s: String = p.strip_edges()
	if s.begins_with("file://"):
		s = s.substr(7).uri_decode()
	return s


## Returns {ok, node, parse_ms, gen_ms, error, path}.
func load_glb(path: String) -> Dictionary:
	var out: Dictionary = {"ok": false, "node": null, "parse_ms": 0.0, "gen_ms": 0.0, "error": "", "path": path}
	if path == "":
		out["error"] = "empty path"
		return out
	if not FileAccess.file_exists(path):
		out["error"] = "missing file"
		return out
	var t0: int = Time.get_ticks_usec()
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err: Error = doc.append_from_file(path, state)
	var t1: int = Time.get_ticks_usec()
	out["parse_ms"] = (t1 - t0) / 1000.0
	if err != OK:
		out["error"] = "append_from_file error %d" % err
		return out
	var node: Node = doc.generate_scene(state)
	out["gen_ms"] = (Time.get_ticks_usec() - t1) / 1000.0
	if node == null or not (node is Node3D):
		if node != null:
			node.free()
		out["error"] = "generate_scene returned no Node3D"
		return out
	out["node"] = node
	out["ok"] = true
	return out
