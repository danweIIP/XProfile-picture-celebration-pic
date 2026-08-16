import os
import math
import json
import threading
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext

# ======================
# 依赖检查（避免闪退）
# ======================
try:
    import requests
except ImportError:
    tk.messagebox.showerror("缺少依赖", "未安装 requests 库，请运行：pip install requests")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    tk.messagebox.showerror("缺少依赖", "未安装 Pillow 库，请运行：pip install Pillow")
    sys.exit(1)

# ======================
# 全局异常捕获（显示错误弹窗）
# ======================
def show_error_and_exit(exc_type, exc_value, tb):
    import traceback
    error_msg = ''.join(traceback.format_exception(exc_type, exc_value, tb))
    messagebox.showerror("程序发生错误", f"错误详情：\n{error_msg}")
    sys.exit(1)

sys.excepthook = show_error_and_exit

# ======================
# 默认设置
# ======================
DEFAULT_SIZE = 200
DEFAULT_SPACING = 4
DEFAULT_BG = "#ADD8E6"

OUTPUT_NAME = "fans_grid.jpg"
AVATAR_DIR = "avatar"
NO_AVATAR_FILE = "no_avatar.txt"


# ======================
# 主程序
# ======================
class App:
    def __init__(self, root):
        self.root = root
        root.title("X粉丝头像工具 v0.7")
        root.geometry("750x700")

        self.data = []
        self.images = []

        # JSON 选择
        frame = tk.Frame(root)
        frame.pack(fill=tk.X, padx=10, pady=5)

        tk.Label(frame, text="JSON文件:").pack(side=tk.LEFT)

        self.json_path = tk.StringVar()
        tk.Entry(frame, textvariable=self.json_path, width=55).pack(side=tk.LEFT, padx=5)
        tk.Button(frame, text="选择", command=self.load_json).pack(side=tk.LEFT)

        # 排序
        sort_frame = tk.Frame(root)
        sort_frame.pack(fill=tk.X, padx=10)

        self.sort_mode = tk.StringVar(value="old")
        tk.Radiobutton(sort_frame, text="老粉 → 新粉", variable=self.sort_mode, value="old").pack(side=tk.LEFT)
        tk.Radiobutton(sort_frame, text="新粉 → 老粉", variable=self.sort_mode, value="new").pack(side=tk.LEFT)

        # 下载按钮
        tk.Button(root, text="下载头像", command=self.start_download).pack(pady=5)

        # 拼图按钮
        tk.Button(root, text="生成粉丝头像墙", command=self.make_grid).pack(pady=5)

        # 日志
        self.logbox = scrolledtext.ScrolledText(root, height=25)
        self.logbox.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

    # ======================
    # 日志
    # ======================
    def log(self, msg):
        self.logbox.insert(tk.END, msg + "\n")
        self.logbox.see(tk.END)
        self.root.update()

    # ======================
    # 导入 JSON
    # ======================
    def load_json(self):
        path = filedialog.askopenfilename(filetypes=[("JSON", "*.json")])
        if not path:
            return

        self.json_path.set(path)
        try:
            with open(path, "r", encoding="utf-8") as f:
                self.data = json.load(f)
            self.log(f"读取成功，共{len(self.data)}人")
            self.sort_data()
        except Exception as e:
            messagebox.showerror("错误", str(e))

    # ======================
    # 时间排序
    # ======================
    def sort_data(self):
        if not self.data:
            return
        if self.sort_mode.get() == "old":
            self.data.sort(key=lambda x: x.get("time", 0))
        else:
            self.data.sort(key=lambda x: x.get("time", 0), reverse=True)
        self.log("排序完成")

    # ======================
    # 下载头像
    # ======================
    def start_download(self):
        threading.Thread(target=self.download_avatar, daemon=True).start()

    def download_avatar(self):
        if not self.data:
            self.log("请先导入JSON")
            return

        os.makedirs(AVATAR_DIR, exist_ok=True)
        no_avatar = []
        total = len(self.data)

        for i, user in enumerate(self.data):
            name = user.get("username", "unknown")
            url = user.get("avatar", "")
            if not url:
                no_avatar.append(name)
                continue

            try:
                ext = ".jpg" if ".png" not in url else ".png"
                # 过滤非法文件名字符
                safe_name = "".join(c for c in name if c.isalnum() or c in "._-")
                filename = os.path.join(AVATAR_DIR, safe_name + ext)

                r = requests.get(url, timeout=10)
                with open(filename, "wb") as f:
                    f.write(r.content)

                self.log(f"{i+1}/{total} {name}")
            except Exception as e:
                self.log(f"{name}失败: {e}")

        if no_avatar:
            with open(NO_AVATAR_FILE, "w", encoding="utf-8") as f:
                f.write("\n".join(no_avatar))

        self.log("头像下载完成")

    # ======================
    # 生成头像墙
    # ======================
    def make_grid(self):
        self.sort_data()

        if not os.path.exists(AVATAR_DIR):
            self.log("没有头像文件夹，请先下载头像")
            return

        files = []
        for user in self.data:
            username = user.get("username", "")
            # 过滤非法字符，匹配下载时的文件名
            safe_name = "".join(c for c in username if c.isalnum() or c in "._-")
            for ext in [".jpg", ".png", ".jpeg", ".webp"]:
                path = os.path.join(AVATAR_DIR, safe_name + ext)
                if os.path.exists(path):
                    files.append(path)
                    break

        if not files:
            self.log("没有找到头像")
            return

        self.log(f"开始生成，共{len(files)}张头像")
        threading.Thread(target=self.create_image, args=(files,), daemon=True).start()

    # ======================
    # 拼图核心
    # ======================
    def create_image(self, files):
        if not files:
            self.log("没有图片需要处理")
            return

        size = DEFAULT_SIZE
        spacing = DEFAULT_SPACING
        count = len(files)

        cols = math.ceil(math.sqrt(count))
        rows = math.ceil(count / cols)

        width = cols * size + (cols + 1) * spacing
        height = rows * size + (rows + 1) * spacing

        canvas = Image.new("RGB", (width, height), DEFAULT_BG)

        for i, path in enumerate(files):
            try:
                img = Image.open(path).convert("RGB")
                w, h = img.size
                side = min(w, h)
                left = (w - side) // 2
                top = (h - side) // 2
                img = img.crop((left, top, left + side, top + side))
                img = img.resize((size, size), Image.LANCZOS)

                x = spacing + (i % cols) * (size + spacing)
                y = spacing + (i // cols) * (size + spacing)
                canvas.paste(img, (x, y))

                if i % 50 == 0:
                    self.log(f"处理中 {i}/{len(files)}")
            except Exception as e:
                self.log(f"{path}失败: {e}")

        output = os.path.join(os.path.expanduser("~"), "Desktop", OUTPUT_NAME)
        canvas.save(output, quality=95)

        self.log("=================")
        self.log("生成完成")
        self.log(output)
        messagebox.showinfo("完成", "头像墙生成完成")


# ======================
# 启动
# ======================
if __name__ == "__main__":
    root = tk.Tk()
    app = App(root)
    root.mainloop()