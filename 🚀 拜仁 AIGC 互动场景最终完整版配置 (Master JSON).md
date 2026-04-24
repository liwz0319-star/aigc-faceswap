### 🚀 拜仁 AIGC 互动场景最终完整版配置 (Master JSON)

JSON

```
{
  "players_database": {
    "1": {
      "name": "Alphonso Davies",
      "prompt_desc": "Alphonso Davies, dark skin, short textured curly black hair, slight beard, strong jawline, recognizable accurate facial features, confident, focused, slight warm smile, highly athletic, extremely fast runner build"
    },
    "2": {
      "name": "Michael Olise",
      "prompt_desc": "Michael Olise, dark skin, distinctive braided hair/dreadlocks falling down, slight mustache and goatee, recognizable accurate facial features, cool, calm, confident expression, lean, agile, youthful winger build"
    },
    "3": {
      "name": "Joshua Kimmich",
      "prompt_desc": "Joshua Kimmich, Caucasian, short light brown hair, sharp cheekbones, distinctive jawline, recognizable accurate appearance, determined, energetic friendly smile, compact, agile, highly athletic build"
    },
    "4": {
      "name": "Harry Kane",
      "prompt_desc": "Harry Kane, Caucasian, short blonde hair, prominent nose, light beard, recognizable accurate features, calm, professional warm smile, tall, strong, robust striker build"
    },
    "5": {
      "name": "Luis Díaz",
      "prompt_desc": "Luis Díaz, tan skin, curly hair with frosted blonde tips, goatee and mustache, prominent cheekbones, visible arm tattoos, recognizable accurate features, passionate, warm energetic smile, lean, highly explosive athletic winger build"
    },
    "6": {
      "name": "Lennart Karl",
      "prompt_desc": "Lennart Karl, Caucasian, youthful face, short brown hair with bangs, light mustache and goatee, recognizable accurate facial features, confident, energetic, slightly open mouth, lean, agile, youthful athletic build"
    },
    "7": {
      "name": "Jamal Musiala",
      "prompt_desc": "Jamal Musiala, light brown skin, short dark curly hair, youthful appearance, recognizable accurate facial features, focused, determined, calm, slender, highly agile, lean attacking midfielder build"
    },
    "8": {
      "name": "Manuel Neuer",
      "prompt_desc": "Manuel Neuer, Caucasian, blue eyes, short light brown hair, slight stubble, mature and commanding appearance, recognizable accurate features, calm, experienced, serious, commanding presence, very tall, broad shoulders, commanding goalkeeper build"
    },
    "9": {
      "name": "Aleksandar Pavlović",
      "prompt_desc": "Aleksandar Pavlović, Caucasian, dark wavy/curly hair, thick prominent eyebrows, light mustache and goatee, recognizable accurate features, intense, focused, determined, tall, lean athletic build"
    },
    "10": {
      "name": "Dayot Upamecano",
      "prompt_desc": "Dayot Upamecano, dark skin, buzz cut, full dark beard, prominent cheekbones, recognizable accurate features, expressive, joyful smile, highly muscular, very strong, robust defender build"
    }
  },
  "scenes_database": {
    "1": {
      "scene_type": "regular",
      "name": "Oktoberfest Gathering",
      "base_image_anchor": "画面1.jpg",
      "environment": "Munich Oktoberfest daytime scene. Wooden balcony railing in foreground, Paulaner and FC Bayern logo signs on poles, a traditional carousel and decorated tree on the right, massive bronze Theresienwiese Bavaria statue in the distant background. Authentic festive Bavarian atmosphere, cloudy daylight.",
      "clothing_adult": "CRITICAL UNIFORM RULE: ALL 4 people MUST wear identical grey traditional Bavarian Janker jackets, dark burgundy vests, white shirts, and distressed Lederhosen.",
      "clothing_child": "CRITICAL UNIFORM RULE: The 3 players wear grey traditional Bavarian Janker jackets and Lederhosen. The child wears matching traditional Bavarian children's clothing.",
      "action_adult": "Exactly 4 people (3 players and the fan) stand shoulder-to-shoulder behind the wooden balcony railing. Everyone is holding a massive classic 1-liter glass Paulaner beer mug with ONE hand, facing the camera with a confident smile.",
      "action_child": "The 3 players stand behind the wooden balcony railing holding 1-liter Paulaner beer mugs. The child fan stands in the absolute center foreground, holding a giant traditional Pretzel high up near their face with BOTH hands, laughing happily at the camera."
    },
    "2": {
      "scene_type": "regular",
      "name": "Locker Room Celebration",
      "base_image_anchor": "画面2.jpg",
      "environment": "FC Bayern Munich inner locker room. Dark blue walls, 'PAULANER' white text logos above open lockers, hanging red jerseys inside lockers, long wooden bench in foreground. Ambient overhead locker room lights.",
      "clothing_adult": "CRITICAL UNIFORM RULE: ALL 4 people MUST wear the EXACT SAME 2025/2026 FC Bayern Munich home kit: bright red jersey with white vertical soundwave-like jagged stripes, large white 'T' logo, and red shorts.",
      "clothing_child": "CRITICAL UNIFORM RULE: ALL 4 people MUST wear the EXACT SAME 2025/2026 FC Bayern Munich home kit: bright red jersey with white vertical soundwave-like jagged stripes, large white 'T' logo, and red shorts.",
      "action_adult": "All 4 people are heavily and firmly SEATED side-by-side on the long wooden bench with feet flat on the ground. Some are pumping their fists in the air, while others hold a tall 0.5-liter Paulaner Weissbier glass (no handle), all cheering excitedly.",
      "action_child": "All 4 people are SEATED on the long wooden bench. The 3 players are pumping their fists in the air. The child fan sits in the center with feet playfully dangling off the ground, holding a red sports water bottle with both hands, smiling brightly."
    },
    "3": {
      "scene_type": "hidden",
      "name": "Championship Shower",
      "base_image_anchor": "背景3-1.jpg",
      "environment": "Allianz Arena pitch at night. Spectacular stadium atmosphere, massive crowd in the stands, red illuminated stadium roof structure. Dramatic high-contrast night stadium floodlights.",
      "clothing_adult": "CRITICAL UNIFORM RULE: ALL 4 people (the 3 players and the fan) MUST wear the EXACT SAME 2025/2026 FC Bayern Munich home kit: bright red jersey with white vertical soundwave-like jagged stripes, large white 'T' logo, and red shorts.",
      "clothing_child": "CRITICAL UNIFORM RULE: ALL 4 people (the 3 players and the child) MUST wear the EXACT SAME 2025/2026 FC Bayern Munich home kit: bright red jersey with white vertical soundwave-like jagged stripes, large white 'T' logo, and red shorts.",
      "action_adult": "Dynamic foreground action: The Fan stands in the center, eyes closed and mouth open laughing. One player stands right next to them, playfully pouring a huge 3-liter glass of beer over the Fan's head with dynamic splashes. The other two players stand in the background, laughing and watching.",
      "action_child": "Dynamic foreground action: The child fan stands in the center looking up, mouth open laughing. One player stands right next to them, popping a confetti cannon to rain colorful confetti over the child's head. The other two players stand in the background, laughing and watching."
    },
    "4": {
      "scene_type": "regular",
      "name": "Bernie Mascot Interaction",
      "base_image_anchor": "画面4.jpg",
      "environment": "Stadium sideline track. Bernie the Mascot walking. Fans sitting in the stadium seats in the background. CRITICAL: ALL background ad boards exclusively display the blue 'PAULANER 0,0%' logo. Absolutely NO Audi logos.",
      "clothing_adult": "CRITICAL UNIFORM RULE: ALL 4 human subjects (the Fan and the 3 players) MUST wear the EXACT SAME 2025/2026 FC Bayern Munich home kit: bright red jersey with white vertical soundwave-like jagged stripes, large white 'T' logo, and red shorts.",
      "clothing_child": "CRITICAL UNIFORM RULE: ALL 4 human subjects (the child and the 3 players) MUST wear the EXACT SAME 2025/2026 FC Bayern Munich home kit: bright red jersey with white vertical soundwave-like jagged stripes, large white 'T' logo, and red shorts.",
      "action_adult": "FOREGROUND FOCUS: The Fan and Bernie the Mascot stand facing each other, happily giving each other a high-five. DISTANT BACKGROUND: The 3 players stand behind them, slightly out of focus, smiling and clapping.",
      "action_child": "FOREGROUND FOCUS: The child fan and Bernie the Mascot stand facing each other. The child looks up to give Bernie a happy high-five. DISTANT BACKGROUND: The 3 players stand behind them, slightly out of focus, smiling and clapping."
    }
  }
}
```

------

### ⚙️ 后端动态拼接模板 (供开发同学参考)

在你的 Node.js 或后端代码中，按照以下逻辑组装最终发给 Seedream API 的 Prompt。你需要确保 `fanDesc` 是在后端基于用户注册信息或选择（年龄、性别）预先算好的。

JavaScript

```
// 【参数预设】
// sceneId: 用户选择的场景 (1, 2, 3, 4)
// mode: 'adult' 或 'child'
// selectedPlayerIds: 数组，例如 ["1", "3", "4"] 代表选择了阿方索、基米希、凯恩
// fanDesc: 动态生成的球迷外貌，如 "an Asian male in his 20s with short black hair"

const scene = scenes_database[sceneId];
const p1 = players_database[selectedPlayerIds[0]].prompt_desc;
const p2 = players_database[selectedPlayerIds[1]].prompt_desc;
const p3 = players_database[selectedPlayerIds[2]].prompt_desc;

const finalPrompt = `
Photorealistic group portrait. Real photograph.

CRITICAL FACE RULE: The fan's face (reference image 1) must look EXACTLY like the person in that photo — same facial features, skin tone, face shape, hair. Do NOT generate a different random face.

THE PEOPLE:
1. ${p1}
2. ${p2}
3. THE FAN — a supporter (${fanDesc}). This is the person whose face matches reference image 1.
4. ${p3}

SETTING:
${scene.environment}

CLOTHING:
${mode === 'adult' ? scene.clothing_adult : scene.clothing_child}

ACTION AND POSE:
${mode === 'adult' ? scene.action_adult : scene.action_child}

Photorealistic, 8K resolution, sharp focus on all faces, professional photography.
`;

// 然后将 finalPrompt 连同 base_image_anchor (你的纯净底图) 一起传给生图 API
```