import os
import math
import hashlib
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext
from PIL import Image
import threading

# ---------- 默认设置 ----------
DEFAULT_SIZE = 200
DEFAULT_SPACING = 4
DEFAULT_BG = "#ADD8E6"
OUTPUT_NAME = "fans_grid.jpg"

class App:
    def __init__(self, root):
        self.root = root
        root.title("粉丝头像拼图 - 简单网格（含去重）")
        root.geometry("700x650")
        root.minsize(500, 450)

        main_frame = tk.Frame(root, padx=10, pady=10)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # 文件夹选择
        folder_frame = tk.Frame(main_frame)
        folder_frame.pack(fill=tk.X, pady=(0, 5))
        tk.Label(folder_frame, text="图片文件夹：").pack(side=tk.LEFT)
        self.folder_var = tk.StringVar(value="")
        self.folder_entry = tk.Entry(folder_frame, textvariable=self.folder_var, width=50)
        self.folder_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(5, 5))
        tk.Button(folder_frame, text="浏览...", command=self.browse_folder).pack(side=tk.LEFT)

        # 参数设置
        param_frame = tk.Frame(main_frame)
        param_frame.pack(fill=tk.X, pady=(0, 10))
        tk.Label(param_frame, text="缩略图大小(px)：").pack(side=tk.LEFT)
        self.size_var = tk.IntVar(value=DEFAULT_SIZE)
        tk.Entry(param_frame, textvariable=self.size_var, width=6).pack(side=tk.LEFT, padx=(0, 15))
        tk.Label(param_frame, text="间距(px)：").pack(side=tk.LEFT)
        self.spacing_var = tk.IntVar(value=DEFAULT_SPACING)
        tk.Entry(param_frame, textvariable=self.spacing_var, width=6).pack(side=tk.LEFT, padx=(0, 15))
        tk.Label(param_frame, text="背景颜色(HEX)：").pack(side=tk.LEFT)
        self.bg_var = tk.StringVar(value=DEFAULT_BG)
        tk.Entry(param_frame, textvariable=self.bg_var, width=10).pack(side=tk.LEFT, padx=(0, 15))

        # 操作按钮第一排：去重
        btn1 = tk.Frame(main_frame)
        btn1.pack(fill=tk.X, pady=(0, 5))
        self.scan_dup_btn = tk.Button(btn1, text="扫描重复图片", command=self.scan_duplicates)
        self.scan_dup_btn.pack(side=tk.LEFT, padx=(0, 10))
        self.del_dup_btn = tk.Button(btn1, text="删除重复（保留每组第一张）", command=self.remove_duplicates, state='disabled')
        self.del_dup_btn.pack(side=tk.LEFT)

        # 操作按钮第二排：拼图
        btn2 = tk.Frame(main_frame)
        btn2.pack(fill=tk.X, pady=(0, 10))
        self.run_btn = tk.Button(btn2, text="开始拼图", command=self.run_grid, state='disabled')
        self.run_btn.pack(side=tk.LEFT)

        # 日志区域
        log_frame = tk.Frame(main_frame)
        log_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 5))
        self.log_area = scrolledtext.ScrolledText(log_frame, width=80, height=15)
        self.log_area.pack(fill=tk.BOTH, expand=True)

        # 状态栏
        status_frame = tk.Frame(main_frame)
        status_frame.pack(fill=tk.X)
        self.status_var = tk.StringVar(value="就绪")
        tk.Label(status_frame, textvariable=self.status_var, fg="gray").pack(side=tk.LEFT)

        self.images = []
        self.dup_groups = []

    def log(self, msg, level="INFO"):
        self.log_area.insert(tk.END, f"[{level}] {msg}\n")
        self.log_area.see(tk.END)
        self.root.update()

    def browse_folder(self):
        folder = filedialog.askdirectory()
        if folder:
            self.folder_var.set(folder)
            self.log(f"已选择：{folder}")
            self.scan_images()

    def scan_images(self):
        folder = self.folder_var.get()
        if not os.path.exists(folder):
            self.log("文件夹不存在", "ERROR")
            return
        valid = ('.jpg','.jpeg','.png','.bmp','.gif','.webp')
        self.images = []
        try:
            for f in sorted(os.listdir(folder)):
                if f.lower().endswith(valid):
                    self.images.append(os.path.join(folder, f))
        except Exception as e:
            self.log(f"读取失败：{e}", "ERROR")
            return
        if self.images:
            self.log(f"找到 {len(self.images)} 张图片")
            self.run_btn['state'] = 'normal'
        else:
            self.log("未找到图片", "WARN")
            self.run_btn['state'] = 'disabled'
        # 重置去重相关
        self.dup_groups = []
        self.del_dup_btn['state'] = 'disabled'

    def scan_duplicates(self):
        folder = self.folder_var.get()
        if not folder or not os.path.exists(folder):
            self.log("请先选择文件夹", "WARN")
            return
        self.log("正在扫描重复图片...")
        self.dup_groups = []
        hash_map = {}
        valid = ('.jpg','.jpeg','.png','.bmp','.gif','.webp')
        try:
            files = sorted(os.listdir(folder))
        except Exception as e:
            self.log(f"读取文件夹失败：{e}", "ERROR")
            return
        for f in files:
            if not f.lower().endswith(valid):
                continue
            path = os.path.join(folder, f)
            try:
                with open(path, 'rb') as fh:
                    h = hashlib.md5(fh.read()).hexdigest()
                hash_map.setdefault(h, []).append(path)
            except Exception as e:
                self.log(f"无法读取 {f}: {e}", "ERROR")
        self.dup_groups = [g for g in hash_map.values() if len(g) > 1]
        if not self.dup_groups:
            self.log("未发现重复图片。", "OK")
            self.del_dup_btn['state'] = 'disabled'
        else:
            total = sum(len(g) for g in self.dup_groups)
            self.log(f"发现 {len(self.dup_groups)} 组重复，共 {total} 张", "WARN")
            for i, group in enumerate(self.dup_groups):
                self.log(f"  重复组 {i+1}: 保留 {os.path.basename(group[0])}")
                for p in group[1:]:
                    self.log(f"           → 可删除 {os.path.basename(p)}")
            self.del_dup_btn['state'] = 'normal'
        self.status_var.set("扫描完成")

    def remove_duplicates(self):
        if not self.dup_groups:
            return
        self.log("开始删除重复图片...")
        deleted = 0
        for group in self.dup_groups:
            for p in group[1:]:
                try:
                    os.remove(p)
                    self.log(f"已删除: {os.path.basename(p)}")
                    deleted += 1
                except Exception as e:
                    self.log(f"删除失败 {os.path.basename(p)}: {e}", "ERROR")
        self.log(f"删除完成，共删除 {deleted} 张", "OK")
        self.dup_groups = []
        self.del_dup_btn['state'] = 'disabled'
        # 刷新图片列表
        self.scan_images()

    def run_grid(self):
        if not self.images:
            self.log("没有图片", "WARN")
            return

        # 读取参数
        try:
            thumb = self.size_var.get()
            spacing = self.spacing_var.get()
            bg_hex = self.bg_var.get().strip()
            if len(bg_hex) != 7 or bg_hex[0] != '#':
                raise ValueError
            r, g, b = int(bg_hex[1:3],16), int(bg_hex[3:5],16), int(bg_hex[5:7],16)
            bg_color = (r, g, b)
        except:
            self.log("参数错误，请检查缩略图大小、间距和颜色格式", "ERROR")
            return

        n = len(self.images)
        cols = math.ceil(math.sqrt(n))
        rows = math.ceil(n / cols)
        total_cells = cols * rows

        self.run_btn['state'] = 'disabled'

        def task():
            self.log(f"开始拼图：{cols}×{rows}，共 {total_cells} 格")
            canvas_w = cols * thumb + (cols + 1) * spacing
            canvas_h = rows * thumb + (rows + 1) * spacing
            canvas = Image.new('RGB', (canvas_w, canvas_h), bg_color)

            for idx, path in enumerate(self.images):
                try:
                    img = Image.open(path).convert('RGB')
                    w, h = img.size
                    side = min(w, h)
                    left = (w - side) // 2
                    top = (h - side) // 2
                    img = img.crop((left, top, left + side, top + side))
                    img = img.resize((thumb, thumb), Image.LANCZOS)
                    row = idx // cols
                    col = idx % cols
                    x = spacing + col * (thumb + spacing)
                    y = spacing + row * (thumb + spacing)
                    canvas.paste(img, (x, y))
                except Exception as e:
                    self.log(f"处理失败 {os.path.basename(path)}: {e}", "ERROR")
                if idx % 50 == 0:
                    self.status_var.set(f"进度：{idx+1}/{n}")
                    self.root.update()

            out_path = os.path.join(os.path.expanduser("~"), "Desktop", OUTPUT_NAME)
            try:
                canvas.save(out_path, quality=95)
                self.log(f"拼图完成！共处理 {n} 张图片", "OK")
                self.log(f"保存位置：{out_path}", "INFO")
                self.status_var.set("拼图完成")
                messagebox.showinfo("完成", f"拼图已保存到桌面：\n{OUTPUT_NAME}")
            except Exception as e:
                self.log(f"保存失败: {e}", "ERROR")
            finally:
                self.run_btn['state'] = 'normal'

        threading.Thread(target=task, daemon=True).start()

if __name__ == "__main__":
    root = tk.Tk()
    app = App(root)
    root.mainloop()