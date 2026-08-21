// 🛡️ 本文件由 XingHuiSama 控制台自动生成，请勿手动修改
export interface Photo { url: string; caption?: string; alt?: string; }
export interface Album { id: string; title: string; description: string; cover: string; date: string; photos: Photo[]; }

export const albums: Album[] = [
  {
    "id": "terra-journey",
    "title": "泰拉大陆纪行",
    "description": "关于源石、孤星与前文明的视觉记录（测试用相册）",
    "cover": "https://bu.dusays.com/2026/03/24/69c24230de927.jpg",
    "date": "2026.01",
    "photos": [
      {
        "url": "https://bu.dusays.com/2026/03/31/69cb69bb530d8.jpg",
        "caption": "原来的人"
      },
      {
        "url": "https://bu.dusays.com/2026/03/24/69c24230de927.jpg",
        "caption": "星空漫游"
      }
    ]
  }
];
