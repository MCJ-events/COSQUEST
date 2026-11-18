// Where each piece of Wale's art sits in his frames: [x, y, w, h] in Figma px (Wardrobe 403 wide, customiser 430 wide).
// Measured from the frame captures by the build-23 art cut (the bounding box of the cut-out, or the inside of his cell).
// Generated with the pictures; change both together.
type Box = readonly [number, number, number, number];

export const BOX = {
  /** The close bust in his Faces frame. Its bottom edge is the bottom of the preview area (y 399). */
  previewFaces: [68.47, 110.34, 299.44, 287.73],
  /** The wider bust in his Hair Styles and Headwear frames. */
  previewBust: [82.92, 87.69, 261.6, 311.49],
  /** The whole-body preview in his Outfits frame. Outfit 1 is measured; 2 to 4 are his card art at the same scale, feet on the same line. */
  previewOutfit: [[148.63, 78.57, 118.28, 315.41], [157.55, 87.72, 108.19, 287.3], [145.51, 91.56, 136.3, 283.05], [133.69, 89.26, 158.19, 296.79]],
  /** The art inside each outfit card. */
  cardOutfit: [[53.89, 545.44, 102.96, 273.71], [267.19, 553.38, 93.89, 249.32], [51.34, 898.01, 118.28, 245.63], [246.48, 896.02, 137.28, 257.55]],
  /** The Wardrobe character: his action pose (outfit 1), then the standing art for outfits 2 to 4 at the same height. */
  wardrobeHero: [[45.75, 204.84, 312.79, 346.46], [136.26, 204.84, 130.47, 346.46], [118.08, 204.84, 166.83, 346.46], [109.16, 204.84, 184.67, 346.46]],
  /** The inside of his eight face cells. */
  face: [[20.22, 526.15, 81.6, 90.83], [122.76, 526.15, 81.25, 90.83], [224.58, 526.15, 81.25, 90.83], [326.05, 526.15, 81.25, 90.83], [20.22, 633.29, 81.6, 91.18], [122.76, 633.29, 81.25, 91.18], [224.58, 633.29, 81.25, 91.18], [326.05, 633.29, 81.25, 91.18]],
  /** The inside of his eight hair cells. */
  hair: [[20.18, 525.03, 81.45, 90.99], [122.91, 525.03, 81.08, 90.99], [224.54, 525.03, 81.45, 90.99], [326.17, 525.03, 81.08, 90.99], [20.18, 632.89, 81.45, 90.99], [122.91, 632.89, 81.08, 90.99], [224.54, 632.89, 81.45, 90.99], [326.17, 632.89, 81.08, 90.99]],
  /** The inside of his eight headwear cells. */
  headwear: [[20.18, 538.23, 81.45, 107.13], [122.91, 538.23, 81.08, 107.13], [224.54, 538.23, 81.45, 107.13], [326.17, 538.23, 81.08, 107.13], [20.18, 666.65, 81.45, 106.77], [122.91, 666.65, 81.08, 106.77], [224.54, 666.65, 81.45, 106.77], [326.17, 666.65, 81.08, 106.77]],
  /** His pink tick on the selected cell, per grid (the first cell of the grid, or the fourth for hair). */
  tick: { faces: [82.22, 527.0, 18.09, 18.8], hair: [387.78, 526.0, 18.34, 17.98], headwear: [76.89, 541.23, 23.11, 23.85], outfits: [173.61, 541.54, 23.83, 23.83] },
  /** His flat tab drawings inside the tab tiles. */
  tabGlyph: { faces: [39.5, 417.04, 22.38, 25.68], hair: [120.05, 417.77, 25.68, 23.85], headwear: [201.67, 425.11, 26.05, 17.61], outfits: [284.04, 419.24, 25.68, 21.28] },
  /** The white glyphs in the Wardrobe round buttons. */
  circle: { face: [41.18, 650.34, 24.16, 26.99], hair: [114.14, 650.34, 27.24, 27.24], headwear: [186.71, 654.97, 27.5, 18.25], outfit: [261.11, 652.91, 28.27, 22.62], companion: [337.43, 648.8, 25.96, 29.56] },
} as const satisfies Record<string, Box | readonly Box[] | Record<string, Box>>;
