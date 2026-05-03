module.exports = {
  male: {
    file: '场景1男.jpg', label: '场景1男（更衣室）',
    mode: 'inpaint', size: '2048x2560', guidance: 10,
    controlProfile: 'scene1_portrait',
    refScale: 0.36, refAnchor: 'north', refOffsetY: 0.14,
    extraPromptLines: [
      'Head swap framing: Replace the whole mannequin head area, including crown, forehead, cheeks, mouth, jawline, and chin.',
      'Neck blend: Keep a natural transition from the lower jaw into the neck opening above the jersey collar.',
      'Size reference: Keep the final head close to the original player head size, not larger.',
    ],
    extraNegativeTerms: [
      'face texture on jersey', 'facial features on torso', 'eyes on clothing', 'mouth on shirt', 'hair on chest',
      'half face', 'side-clipped face', 'cropped forehead', 'cropped chin',
      'dark head hole', 'black face void',
      'cartoon face', 'anime face', 'cgi face', 'doll face', 'oversized eyes',
    ],
    mask: {
      cx: 1140, cy: 844, w: 168, h: 276,
      apiCx: 1142, apiCy: 844, apiW: 164, apiH: 264,
      compCx: 1142, compCy: 846, compW: 180, compH: 284,
      compSolidTopH: 104,
      compSolidTopInset: 16,
      compFeather: 10,
    },
  },
  female: {
    file: '场景1女.jpg', label: '场景1女（更衣室）',
    mode: 'inpaint', size: '2048x2560', guidance: 10,
    controlProfile: 'scene1_portrait',
    refScale: 0.34, refAnchor: 'north', refOffsetY: 0.14,
    extraPromptLines: [
      'Head swap framing: Replace the whole mannequin head area, including crown, forehead, cheeks, mouth, jawline, and chin.',
      'Neck blend: Keep a natural transition from the lower jaw into the neck opening above the jersey collar.',
      'Size reference: Keep the final head close to the original player head size, not larger.',
    ],
    extraNegativeTerms: [
      'face texture on jersey', 'facial features on torso', 'eyes on clothing', 'mouth on shirt', 'hair on chest',
      'half face', 'side-clipped face', 'cropped forehead', 'cropped chin',
      'dark head hole', 'black face void',
      'cartoon face', 'anime face', 'cgi face', 'doll face', 'oversized eyes',
    ],
    mask: {
      cx: 1140, cy: 846, w: 164, h: 282,
      apiCx: 1142, apiCy: 846, apiW: 162, apiH: 270,
      compCx: 1142, compCy: 848, compW: 178, compH: 292,
      compSolidTopH: 108,
      compSolidTopInset: 16,
      compFeather: 10,
    },
  },
};
