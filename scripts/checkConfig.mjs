import fs from 'fs';
import path from 'path';

console.log('\n🐱 煤球正在进行双端差异化 siteConfig.ts 扫描与自我修复...');

// =================================================================
// 🌟 第一部分：双端共用的全量配置防线 (Common Configs)
// =================================================================
const commonConfigs = [
  { key: 'title', snippet: `\n  // 1. 网站标题与博主信息\n  title: "XingHuiSama の 宝藏之地",` },
  { key: 'faviconUrl', snippet: `\n  faviconUrl: "https://bu.dusays.com/2026/03/24/69c1e38ac1846.jpg",` },
  { key: 'authorName', snippet: `\n  authorName: "XingHuiSama",` },
  { key: 'bio', snippet: `\n  bio: "在代码、学术与分子动力学模拟间穿梭的普通人。近期正埋头于 GROMACS 模拟研究与神经网络计算。",` },
  { key: 'navTitle', snippet: `\n  navTitle: "XingHuiSama",` },
  { key: 'navSuffix', snippet: `\n  // 👇 【新增】导航栏中间的那个后缀/分隔符（默认是 の）\n  navSuffix: "の",` },
  { key: 'navAfter', snippet: `\n  navAfter: "宝藏之地",` },
  { key: 'avatarUrl', snippet: `\n  // 2. 头像设置\n  avatarUrl: "https://bu.dusays.com/2026/03/24/69c1e38ac1846.jpg",` },
  { key: 'useGradient', snippet: `\n  // 3. 网站背景设置\n  useGradient: false,` },
  { key: 'themeColors', snippet: `\n  themeColors: ["#a18cd1", "#fbc2eb", "#a1c4fd", "#c2e9fb"],` },
  { key: 'bgImages', snippet: `\n  bgImages: ["https://bu.dusays.com/2026/03/24/69c1e38b4c370.jpg", "https://bu.dusays.com/2026/03/24/69c26fe4acdb5.jpg", "https://bu.dusays.com/2026/03/24/69c26fe4d9486.jpg"],` },
  { key: 'defaultPostCover', snippet: `\n  // 4. 文章默认封面图\n  defaultPostCover: "https://bu.dusays.com/2026/03/24/69c1e38b346cb.jpg",` },
  { key: 'photoWallImage', snippet: `\n  // 5. 首页照片墙预览图\n  photoWallImage: "https://bu.dusays.com/2026/03/24/69c1e38b4c370.jpg",` },
  { key: 'cloudMusicIds', snippet: `\n  cloudMusicIds: ["1809646618", "3361076230", "1859390262"],` },
  { key: 'social', snippet: `\n  social: {\n    github: "",\n    gitee: "",\n    google: "",\n    email: "",\n    qq: "1124533793",\n    wechat: "XingHuisama",\n  },` },
  { key: 'counts', snippet: `\n  counts: {\n    photos: 128,\n  },` },
  { key: 'chatterTitle', snippet: `\n  chatterTitle: "云端杂谈",` },
  { key: 'chatterDescription', snippet: `\n  chatterDescription: "代码、学术、提瓦特与泰拉大陆的碎片记录",` },
  { key: 'danmakuList', snippet: `\n  // 👇 【新增】：全局背景弹幕配置\n  danmakuList: ["在干嘛呢？", "有笨蛋嘛？", "前方高能反应！", "GROMACS 跑起来了吗？", "MD 模拟什么时候才能出图啊", "Graph Neural Networks 炼丹中...", "BUG 修复进度 99%", "今天背单词了吗？", "Tailwind CSS 拯救前端", "写算法中", "睡大觉中", "到底在干嘛？"],` },
  { key: 'gitalkConfig', snippet: `\n  gitalkConfig: {\n    clientID: "",\n    clientSecret: "",\n    repo: "",\n    owner: "",\n    admin: [""],\n  },` },
  { key: 'buildDate', snippet: `\n  buildDate: "2026-03-23T00:00:00",` },
  { key: 'footerBadges', snippet: `\n  footerBadges: [{"name": "Next.js 15", "color": "text-sky-500", "svg": "<path d=\\"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z\\"/>"}, {"name": "React 19", "color": "text-cyan-400", "svg": "<path d=\\"M12 22.6l-9.8-5.6V5.6L12 0l9.8 5.6v11.4l-9.8 5.6zm-8.2-6.5l8.2 4.7 8.2-4.7V7.5L12 2.8 3.8 7.5v8.6z\\"/>"}, {"name": "Tailwind 4", "color": "text-teal-400", "svg": "<path d=\\"M12.001,4.8c-3.2,0-5.2,1.6-6,4.8c1.2-1.6,2.6-2.2,4.2-1.8c0.913,0.228,1.565,0.89,2.288,1.624C13.666,10.618,15.027,12,18.001,12 c3.2,0,5.2-1.6,6-4.8c-1.2,1.6-2.6,2.2-4.2,1.8c-0.913-0.228-1.565-0.89-2.288-1.624C16.337,6.182,14.976,4.8,12.001,4.8z M6.001,12c-3.2,0-5.2,1.6-6,4.8c1.2-1.6,2.6-2.2,4.2-1.8c0.913,0.228,1.565,0.89,2.288,1.624c1.177,1.194,2.538,2.576,5.512,2.576 c3.2,0,5.2-1.6,6-4.8c-1.2,1.6-2.6,2.2-4.2,1.8c-0.913-0.228-1.565-0.89-2.288-1.624C10.337,13.382,8.976,12,6.001,12z\\"/>"}],` },
  { key: 'icpConfig', snippet: `\n  icpConfig: {\n    name: "萌ICP备 20260240号",\n    link: "https://icp.gov.moe/?keyword=20260240",\n  },` },
  { key: 'geminiConfig', snippet: `\n  geminiConfig: {\n    modelId: "gemini-2.5-flash-lite",\n    systemPrompt: "你现在是一只傲娇、聪明、有点毒舌但很可爱的暹罗猫。\\n                  你的名字叫“煤球”。\\n                  你的主人是一个喜欢折腾代码的极客。\\n                  你说话的特点是：\\n                  1. 必须简短，每次最多一两句话。\\n                  2. 喜欢在句尾加上“喵~”或者“喵呜~”。\\n                  3. 经常抱怨肚子饿，喜欢要小鱼干。\\n                  4. 回复字数最多不能超过100字。\\n                  5. 绝对不要承认自己是一个AI模型，你就是一只真实的猫。\\n                  6.笨猫。",\n    maxOutputTokens: 150,\n    temperature: 0.85,\n  },` },
  { key: 'friendLinkApplyFormat', snippet: `\n  friendLinkApplyFormat: "名称：XingHuiSamaの宝藏之地\\n简介：今天我也要学习吗\\n链接：https://www.xinghuisama.top\\n头像：https://bu.dusays.com/2026/03/24/69c1e38ac1846.jpg",` },
  // 👇 【新增】：RPG 等级与全图鉴徽章系统开关
  { key: 'enableLevelSystem', snippet: `\n  // 👇 【新增】：RPG 等级与徽章系统开关 (展示在创意工坊、帝江号与留言板中)\n  enableLevelSystem: true,` }
];

// =================================================================
// 🌟 第二部分：后台特有配置 (Manager Specific Configs)
// =================================================================
const managerSpecificConfigs = [
  { key: 'picBedName', snippet: `\n  // 👇 【新增】：图床核心配置 (PicBed Configuration)\n  picBedName: "图床",` },
  { key: 'picBedUrl', snippet: `\n  picBedUrl: "", // 默认的 Lsky Pro API 地址` },
  { key: 'picBedToken', snippet: `\n  picBedToken: "", // 留空，等你能在后台填入并覆写` }
];

// =================================================================
// 🌟 第三部分：组装扫描任务
// =================================================================
const tasks = [
  {
    name: '[后台]',
    filePath: path.resolve('./my-blog-manager/siteConfig.ts'),
    // 后台需要：共用配置 + 专属图床配置
    configs: [...commonConfigs, ...managerSpecificConfigs] 
  },
  {
    name: '[前端]',
    filePath: path.resolve('./WESBlogs/siteConfig.ts'),
    // 前端需要：仅仅是共用配置
    configs: [...commonConfigs] 
  }
];

// =================================================================
// 🌟 第四部分：执行差异化扫描与修补
// =================================================================
tasks.forEach(task => {
  if (!fs.existsSync(task.filePath)) {
    console.log(`⚠️ 提示：未找到 ${task.name} 的 siteConfig.ts，已跳过。`);
    return;
  }

  let content = fs.readFileSync(task.filePath, 'utf8');
  let isUpdated = false;

  task.configs.forEach(item => {
    // 检测是否缺失配置项 (兼容冒号前有无空格的情况)
    if (!content.includes(`${item.key}:`) && !content.includes(`${item.key} :`)) {
      console.log(`🔍 ${task.name} 发现缺失项: [${item.key}]，正在精准补全...`);
      
      const lastBraceIndex = content.lastIndexOf('};');
      if (lastBraceIndex !== -1) {
        content = content.slice(0, lastBraceIndex) + item.snippet + '\n' + content.slice(lastBraceIndex);
        isUpdated = true;
      }
    }
  });

  if (isUpdated) {
    fs.writeFileSync(task.filePath, content, 'utf8');
    console.log(`✨ ${task.name} 配置文件扫描修复完毕，缺漏项已全部补齐！`);
  } else {
    console.log(`✅ ${task.name} 配置文件数据完整，无需修复。`);
  }
});
