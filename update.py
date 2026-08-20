import os
import sys
import subprocess
import shutil

# 强制切换到脚本所在目录
os.chdir(os.path.dirname(os.path.abspath(__file__)))


def print_step(msg):
    print(f"\n{'=' * 55}\n🐱 {msg}\n{'=' * 55}")


def run_cmd(cmd, cwd=None):
    try:
        subprocess.run(cmd, shell=True, check=True, cwd=cwd)
        return True
    except subprocess.CalledProcessError:
        print(f"❌ 命令执行失败: {cmd}")
        return False


def main():
    print_step("XingHuiSama升级程序 (Python 稳定版)")

    # 1. 环境自检
    if not shutil.which("git"):
        print("❌ 致命错误：未找到 Git！请前往 git-scm.com 下载安装。")
        sys.exit(1)
    if not shutil.which("node") or not shutil.which("npm"):
        print("❌ 致命错误：未找到 Node.js/npm！请先安装 Node.js。")
        sys.exit(1)

    # 2. Git 仓库修复
    if not os.path.exists(".git"):
        print("🪄 初始化 Git 环境...")
        run_cmd("git init")
        run_cmd("git remote add origin https://github.com/heiehiehi/XinghuisamaBlogs.git")

    # 3. 拉取更新
    print_step("[1/4] 连接云端获取最新代码...")
    if not run_cmd("git fetch origin main"):
        sys.exit(1)

    # 4. 精准替换文件（再也不怕空格和换行符了！）
    print_step("[2/4] 执行核心文件精准替换...")
    files_to_update = [
        "update.py", "update.bat",
        "LICENSE", "README.md", "scripts/checkConfig.mjs", "README_en.md",

        # 前端文件
        "WESBlogs/app/about/page.tsx", "WESBlogs/app/api", "WESBlogs/app/chatter",
        "WESBlogs/app/friends", "WESBlogs/app/moments", "WESBlogs/app/music",
        "WESBlogs/app/photowall", "WESBlogs/app/posts", "WESBlogs/app/projects",
        "WESBlogs/app/timeline", "WESBlogs/app/globals.css", "WESBlogs/app/layout.tsx",
        "WESBlogs/app/page.tsx", "WESBlogs/components", "WESBlogs/public", "WESBlogs/app/tree",
        "WESBlogs/.gitignore", "WESBlogs/package.json", "WESBlogs/package-lock.json",
        "WESBlogs/postcss.config.mjs", "WESBlogs/tsconfig.json",

        # 后台文件
        "my-blog-manager/app/about/page.tsx", "my-blog-manager/app/admin",
        "my-blog-manager/app/api", "my-blog-manager/app/chatter",
        "my-blog-manager/app/drafts", "my-blog-manager/app/editor",
        "my-blog-manager/app/friends", "my-blog-manager/app/moments",
        "my-blog-manager/app/music", "my-blog-manager/app/photowall",
        "my-blog-manager/app/posts", "my-blog-manager/app/projects",
        "my-blog-manager/app/settings", "my-blog-manager/app/timeline",
        "my-blog-manager/app/globals.css", "my-blog-manager/app/layout.tsx",
        "my-blog-manager/app/page.tsx", "my-blog-manager/cms_core",
        "my-blog-manager/components", "my-blog-manager/context", "my-blog-manager/app/tree",
        "my-blog-manager/.gitignore", "my-blog-manager/launcher.py", "my-blog-manager/public",
        "my-blog-manager/package.json", "my-blog-manager/package-lock.json",
        "my-blog-manager/postcss.config.mjs", "my-blog-manager/run_me.py",
        "my-blog-manager/Start.bat", "my-blog-manager/tsconfig.json"
    ]

    checkout_cmd = f"git checkout origin/main -- {' '.join(files_to_update)}"
    run_cmd(checkout_cmd)

    # 5. 安装依赖
    print_step("[3/4] 同步依赖包...")
    if os.path.exists("WESBlogs"):
        run_cmd("npm install", cwd="WESBlogs")
    if os.path.exists("my-blog-manager"):
        run_cmd("npm install", cwd="my-blog-manager")

    # 6. 修补配置
    print_step("[4/4] 智能修补 siteConfig 配置文件...")
    if os.path.exists(os.path.join("scripts", "checkConfig.mjs")):
        run_cmd("node scripts/checkConfig.mjs")

    print_step("✨ 升级完毕！如果有遗漏，请再次启动本程序！")


if __name__ == "__main__":
    main()
