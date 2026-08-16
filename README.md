# XAvatarWall

<div align="center">

## X(Twitter) Follower Avatar Wall Generator

一个用于制作 X（Twitter）粉丝纪念头像墙的工具。

自动整理粉丝头像，并生成一张高清粉丝纪念图片。

</div>


## ✨ 功能特点

- 📷 自动采集 X(Twitter) 粉丝头像
- 🖼️ 自动整理头像文件
- 🧩 自动生成头像墙图片
- 🔍 图片重复检测
- 📐 自动计算最佳排列布局
- 🚀 支持大量头像处理
- 🖥️ 支持 Windows Python 运行


## 🎯 使用场景

适用于：

- 🎉 粉丝突破纪念
- 📈 账号成长记录
- 🏆 社区活动展示
- 🎂 周年纪念图片制作


例如：

```
100 Followers
500 Followers
1000 Followers
10000 Followers
```

都可以生成专属粉丝头像墙。


---

# 📂 项目结构

```
XAvatarWall

│
├── crawler
│   └── X头像采集工具
│
├── avatars
│   └── 存放粉丝头像
│
├── output
│   └── 输出生成图片
│
├── generator.py
│   └── 图片合成程序
│
└── README.md
```


---

# 🛠️ 安装环境

需要：

- Python 3.10+
- Pillow


安装依赖：

```bash
pip install pillow requests aiohttp tqdm
```


如果下载速度较慢，可以使用国内镜像：

```bash
pip install pillow requests aiohttp tqdm -i https://pypi.tuna.tsinghua.edu.cn/simple
```


---

# 🚀 使用方法


## 方法一：已有头像生成图片

如果你已经拥有粉丝头像：

创建文件夹：

```
avatars
```

将头像全部放入：

```
avatars/
```

支持格式：

```
jpg
jpeg
png
webp
bmp
```

然后运行：

```bash
python generator.py
```


生成结果：

```
output/fans_grid.jpg
```


---

## 方法二：使用采集工具

流程：

```
X粉丝页面
      ↓
头像采集工具
      ↓
保存头像
      ↓
XAvatarWall
      ↓
生成粉丝头像墙
```


---

# 🖼️ 图片生成规则

程序会自动：

- 根据头像数量计算布局
- 自动排列头像
- 自动裁剪为正方形
- 保持头像比例
- 生成高清图片


无需手动设置：

```
10个头像
100个头像
1000个头像
```

均可自动生成。


---

# 🧹 图片处理功能

支持：

✅ 自动跳过损坏图片

✅ 自动检测重复图片

✅ 自动处理不同尺寸头像

✅ 自动排列大量图片


---

# ⚙️ 排列示例

输入：

```
○ ○ ○
○ ○ ○
○ ○ ○
```

输出：

```
粉丝头像纪念墙
```


---

# ⚠️ 注意事项

- 请合理使用 X(Twitter) 数据
- 请遵守 X 平台规则
- 不建议用于商业化批量抓取


---

# 👨‍💻 作者

Created by **Qiujiu**

X:

https://x.com/qiujiudev


---

# ⭐ 支持项目

如果这个项目帮助到了你：

- 给项目点一个 Star ⭐
- 提交 Issue
- 提交改进建议


---

# 📜 License

MIT License
