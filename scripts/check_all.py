"""Full project check: build, tests, web type-check, web build, examples, and a
grep that web markup contains no Tailwind utility classes. Read-only apart from
build output and examples/. Run: python scripts/check_all.py"""
import pathlib
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # tool output contains box-drawing characters
root = pathlib.Path(__file__).resolve().parent.parent
bun = "bun"


def step(title, cmd, cwd=root, tail=6):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    lines = [l for l in (r.stdout + r.stderr).splitlines() if l.strip()]
    print(f"--- {title}: {'ok' if r.returncode == 0 else 'FAILED'}")
    print("\n".join(lines[-tail:]))
    return r.returncode == 0


ok = True
ok &= step("build core/cli/mcp", [bun, "run", "build"])
ok &= step("tests", [bun, "x", "vitest", "run"], tail=5)
ok &= step("svelte-check", [bun, "x", "svelte-check", "--tsconfig", "./tsconfig.json"], cwd=root / "packages" / "web", tail=1)
ok &= step("web build", [bun, "x", "vite", "build"], cwd=root / "packages" / "web", tail=2)
ok &= step("examples", [sys.executable, str(root / "scripts" / "make_examples.py")], tail=3)

# Markup must use semantic class names only; utilities belong in .css files via @apply.
utility = re.compile(r"^(flex|grid|hidden|block|inline|absolute|relative|truncate|(p|m|gap|w|h|min|max|text|bg|border|rounded|items|justify|font|leading|tracking|opacity|shadow|overflow|z)[a-z]?-.+)$")
bad = []
for f in (root / "packages" / "web" / "src").rglob("*.svelte"):
    for m in re.finditer(r'class="([^"{]*)"', f.read_text(encoding="utf-8")):
        bad += [f"{f.name}: {c}" for c in m.group(1).split() if utility.match(c)]
print(f"--- utility classes in markup: {'none' if not bad else bad}")
ok &= not bad
print("ALL OK" if ok else "SOMETHING FAILED")
