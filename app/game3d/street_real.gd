extends RefCounted
## fid29 seam (docs/game3d/fid29/COMMON.md). Owned by the fid29-street lane; created as a no-op by fid29-base.
## arena.gd calls apply_floor once the street floor (the paved plane under every arena) and the medallion (or a
## place's faction ring) have their materials, with the arena's look. The lane's work goes behind look "fid_street"
## (mid and high only): with the key off, or on the low tier, this must leave both materials as they came.


static func apply_floor(_arena: Node3D, _look: Dictionary, _floor_mat: Material, _medallion_mat: Material) -> void:
	pass
