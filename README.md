
# XAvatarWall

<div align="center">

## X(Twitter) Follower Avatar Wall Generator

一个用于制作 X（Twitter）粉丝纪念头像墙的工具。

自动整理粉丝头像，并生成一张高清粉丝纪念图片。

</div>

---

[moaeiou 的版本](https://github.com/qiujiu-dev/XAvatarWall)也非常出色，感谢贡献！

---

## 获取代码

首先，你需要从本仓库获取所有代码文件。仓库地址：  
https://github.com/qiujiu-dev/XAvatarWall

直接在仓库页面点击绿色的 **Code** 按钮，选择 **Download ZIP**，下载后解压到本地任意文件夹即可。

> 最终你会得到包含所有脚本和配置文件的本地文件夹。

---

## 启动程序

获取代码后，直接双击 **一键启动.bat** 即可运行。

如果你电脑上 **没有安装 Python**，或者安装了但缺少依赖库（如 Pillow），或者运行时报错提示缺少模块，一键启动会自动处理这些问题：

- 自动检测 Python 环境，若未安装则提示安装
- 自动安装所需的第三方库（pillow, requests, aiohttp, tqdm）
- 自动打开主程序界面，你可以从中选择需要使用的功能

> 此方式省去手动配置环境的步骤，推荐给所有用户。

---

## 使用流程

### 流程一：已有头像文件（自备图片）

如果你已经拥有粉丝头像图片（任意格式），双击 `一键启动.bat`，选择"自备图片拼图"功能，按以下步骤操作：

1. 在弹出的界面中选择存放头像的文件夹或选择图片文件。
2. 程序会自动进行图片查重，去除重复头像。
3. 点击"生成"按钮，即可合成粉丝头像墙图片。
4. 生成的图片将保存在指定输出目录（通常为 `output/`）。

### 流程二：无头像文件（需从 X 采集）

如果你尚未获取粉丝头像，双击 `一键启动.bat`，选择"头像制作器"功能，按以下步骤操作：

1. 安装篡改猴（Tampermonkey）浏览器扩展（如已安装可跳过）。
2. 安装本工具提供的用户脚本：`一键下载头像.user.js`。
3. 打开 X（Twitter）并进入你的**关注（Following）** 页面。
4. 点击页面右下角的**相机图标**，脚本将自动开始爬取粉丝头像。
5. 爬取完成后，导出数据为 JSON 文件。
6. 在头像制作器界面中导入刚才导出的 JSON 文件。
7. 程序将自动下载所有头像，并直接合成粉丝头像墙图片。

> 提示：请合理使用脚本，遵守 X 平台规则，避免高频请求。

---

## 作者

Created by **Qiujiu**  
X: https://x.com/qiujiudev

---

## 🛠 贡献者

- **Qiujiu** <https://x.com/qiujiudev>
- **MoAEIOU** <https://867678.xyz>

---

## 支持项目

如果这个项目帮助到了你：

- 给项目点一个 Star
- 提交 Issue
- 提交改进建议

---

## ⚖️ 条款与授权

- 请合理使用 X(Twitter) 数据
- 请遵守 X 平台规则
- 不建议用于商业化批量抓取

本项目基于 [GNU Affero General Public License Version 3 (AGPL-V3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 或更高版本授权。
