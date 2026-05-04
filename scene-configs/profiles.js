module.exports = {
  default: {
    taskLine: 'Task: Replace ONLY the head and neck area inside the white mask region with the person from Image 2.',
    promptLines: [],
    negativeTerms: [],
  },
  scene1_portrait: {
    taskLine: 'Task: Perform a photorealistic head swap. Replace the entire placeholder head and upper neck inside the white mask region with the person from Image 2.',
    promptLines: [
      'Head swap framing: Replace the full placeholder head from crown to chin, not just the center face. Keep the full forehead, both cheeks, jawline, and chin visible.',
      'Head size lock: Match the original player head size in Image 1. Do NOT make the head oversized relative to the shoulders or torso.',
      'Realism lock: The face must remain a real photographic human face. No cartoon, no CGI, no doll-like stylization, and no oversized eyes.',
      'Neck blend: Generate a natural jaw-to-neck transition that dissolves smoothly into the collar opening.',
    ],
    negativeTerms: [
      'half face', 'cropped forehead', 'cropped chin', 'off-center face',
      'cartoon face', 'anime face', 'cgi face', 'doll face', 'oversized eyes',
    ],
  },
  scene4_festival: {
    taskLine: 'Task: Perform a photorealistic head swap. Replace the full placeholder head and upper neck inside the white mask region with the person from Image 2 for a natural outdoor festival group portrait.',
    promptLines: [
      'Jaw completion: The full lower face must be fully generated, including nose base, lips, chin, jawline, and the front of the neck.',
      'No mannequin carry-over: Do NOT leave any mannequin skin, blank mannequin texture, or melted placeholder surface under the mouth or around the chin.',
      'Festival portrait fit: Keep the head naturally sized for the group photo and slightly smaller than the current placeholder width if needed.',
      'Hair edge quality: Keep the hairline and outer hair edges clean and natural, with no dark halo, soot-like fringe, or muddy edge glow.',
      'Placeholder coverage: Fully cover the blank placeholder head from ear to ear. Do NOT leave any visible placeholder edge on the left or right side.',
      'Single-head rule: Generate exactly one aligned head centered on the placeholder neck. Do NOT create a second face beside the placeholder.',
      'Background blend: Preserve the original sky and tree colors from Image 1 and blend the head edge naturally into the background.',
      'Head size lock: Match the original footballer head size in Image 1. The inserted head must stay proportional to the shoulders and torso.',
      'Realism lock: The face must remain a real photographic human face. No cartoon, no CGI, no doll-like stylization, and no oversized eyes.',
    ],
    negativeTerms: [
      'missing chin', 'melted lower face', 'blank mannequin neck', 'placeholder skin', 'unfinished jawline',
      'dark halo around hair', 'black fringe around hairline', 'muddy hair edge',
      'double face', 'duplicate face', 'adjacent face', 'offset face', 'residual mannequin head',
      'oversized head', 'giant head', 'tiny body large head',
      'rectangular crop edge', 'visible box edge', 'background patch edge',
      'cartoon face', 'anime face', 'cgi face', '3d render face', 'doll face', 'toy face', 'oversized eyes', 'plastic skin',
    ],
  },
};
