extends RefCounted
## fid29 seam (docs/game3d/fid29/COMMON.md). Owned by the fid29-heromaps lane; created as a no-op by fid29-base.
## fight.gd asks it which file a fighter really loads, after the hero cast and the tier's detail level chose one
## (role: "hero", "ally" or "enemy"; look: the arena's look). The lane's work goes behind look "fid_heromaps" (mid
## and high only): with the key off, or on the low tier, it must return `path` unchanged. Presentation only: the
## fight's rules never read the model.


static func pick(path: String, _role: String, _look: Dictionary) -> String:
	return path
