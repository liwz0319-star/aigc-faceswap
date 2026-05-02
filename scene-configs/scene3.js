module.exports = {
  male: {
    file: '场景3.jpg', label: '场景3（通道举9号球衣）',
    mode: 'inpaint', size: '2560x1536', guidance: 10,
    refScale: 0.49, refAnchor: 'north',
    extraPromptLines: [
      'Full crown visibility: Keep the entire top hair, crown, and upper hair volume fully visible above the forehead.',
      'Hair solidity: Hair at the top of the head must be dense, opaque, and well-defined. No translucent top hair and no faded crown.',
      'Jersey clearance: Keep the chin and jawline clearly separated above the top edge of the jersey.',
    ],
    extraNegativeTerms: [
      'faded crown', 'translucent top hair', 'missing top hair', 'cropped crown', 'face too large for template',
    ],
    mask: {
      cx: 934, cy: 288, w: 208, h: 366,
      apiCx: 934, apiCy: 276, apiW: 182, apiH: 336,
      compCx: 934, compCy: 286, compW: 220, compH: 388,
      compSolidTopH: 108,
      compSolidTopInset: 14,
    },
  },
  female: {
    file: '场景3.jpg', label: '场景3（通道举9号球衣）',
    mode: 'inpaint', size: '2560x1536', guidance: 10,
    refScale: 0.36, refAnchor: 'north', refOffsetY: 0.08,
    extraPromptLines: [
      'Full crown visibility: Keep the entire top hair, crown, and upper hair volume fully visible above the forehead.',
      'Hair solidity: Hair at the top of the head must be dense, opaque, and well-defined. No translucent top hair and no faded crown.',
      'Female head scale: Keep the female head slightly smaller inside the placeholder so the full hair silhouette, temples, cheeks, jawline, and chin fit naturally.',
      'Jersey clearance: Keep the chin and jawline clearly separated above the top edge of the jersey.',
      'Long-hair routing: If the person in Image 2 has medium or long hair, let the side hair fall naturally behind the shoulders and upper back of Image 1.',
      'Do NOT drape long hair across the front of the jersey or over the center chest area.',
      'Shoulder clearance: Keep the front neckline and upper chest of the jersey clean and unobstructed. Any longer side hair should stay near the outer shoulder line or behind it.',
      'Shoulder integrity: Keep the original shoulder line and jersey shoulder seam from Image 1 clean and single. No duplicate shoulder edge, no ghost shoulder, and no second neck or hair shadow on the shoulders.',
      'Hair-tip clarity: The lower ends of the hair should taper into visible strands with a clean natural edge, not into a foggy or airbrushed blur.',
    ],
    extraNegativeTerms: [
      'oversized female head', 'faded crown', 'translucent top hair', 'missing top hair', 'cropped crown',
      'long hair over front jersey', 'hair across chest', 'hair covering shirt collar', 'front-draped hair curtain',
      'ghost shoulder', 'duplicate shoulder edge', 'double shoulder line', 'bald crown', 'flat top hair',
      'foggy hair tips', 'airbrushed hair ends', 'hair blur cloud', 'mushy hair edge',
    ],
    mask: {
      cx: 934, cy: 284, w: 194, h: 370,
      apiCx: 934, apiCy: 270, apiW: 168, apiH: 352,
      compCx: 934, compCy: 278, compW: 196, compH: 370,
      compSolidTopH: 136,
      compSolidTopInset: 26,
      compFeather: 10,
    },
  },
};
