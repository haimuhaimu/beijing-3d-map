# 依赖与素材说明

## Three.js 0.180.0 — MIT

Copyright 2010–2025 Three.js Authors. MIT 全文见 [vendor/LICENSE](vendor/LICENSE)。

来源：[官方 npm 发行包](https://registry.npmjs.org/three/-/three-0.180.0.tgz)、[r180 源码](https://github.com/mrdoob/three.js/tree/r180)。本项目五个运行 JS 文件与官方包一致：其中三个仅增加既有 `eslint-disable` 首行注释，另两个完全未修改；MIT 许可文件也一致。具体文件见 [vendor/README.md](vendor/README.md)。

## Noto Sans CJK SC Regular — SIL OFL 1.1

Copyright 2014–2021 Adobe (http://www.adobe.com/). Noto is a trademark of Google Inc.

字体来源：[notofonts/noto-cjk 固定版本](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans)。许可全文见 [vendor/Noto-OFL.txt](vendor/Noto-OFL.txt)。模型的 29 个招牌文字物体由该字体重新生成；不包含系统 Arial Unicode 字体或旧文字轮廓缓存，也不包含字体二进制。浏览器中的普通 UI 文字使用设备自己的系统字体，不下载网络字体。

## 地图、预览和地点资料

- 模型由本项目的 Blender 程序化几何工程生成；未发现导入的外部模型或纹理。发布 GLB 无 images、textures、外部 buffer，也不依赖素材服务器。
- `preview.png` 是此公开版本在浏览器中的场景截图，不是旅游照片或网站截图。
- `places.json` 为项目编写的简短地点描述、艺术化位置与地标元数据。来源 URL 是事实核对入口，不表示引用网站授权了图片或模型；本包未复制这些网站的图片。
- 原创代码、模型和文字由 Chen Quan / 陈全公开展示，暂保留权利；[LICENSE](LICENSE) 不改变第三方各自的许可。`private: true` 只防止误发 npm，不表示 GitHub 仓库私有。
- 景区、品牌、建筑与地名仅用于艺术化地图指认；本项目不隶属于相关机构，不宣称获得背书，也不授予相关商标或建筑设计的权利。
- 地图不是导航、测绘或官方地图。距离与比例被压缩；崇礼不在北京市内。

来源检查是工程发布核验，不是对全部知识产权作法律担保。公开包不含人物照片、其他作品集页面、私人笔记、凭证、旧字形缓存或完整私有项目历史。
