"""The service worker's offline file list (SHELL in app/sw.js), written by build_app.py from what is in app/.

Needs no python-chess, so it runs wherever Python does. Run: python3 -m unittest tests.test_offline_shell
"""
import importlib.util, pathlib, re, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("pipeline_build_app", ROOT / "build_app.py")
build_app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_app)


def shell_in(sw_text):
    return re.findall(r"'([^']+)'", re.search(r"const SHELL = \[(.*?)\];", sw_text, re.S).group(1))


class TestOfflineShell(unittest.TestCase):
    def test_committed_sw_lists_every_module(self):
        # an app/*.js module missing here breaks the next offline start after an update (#125)
        shell = shell_in((ROOT / "app/sw.js").read_text())
        modules = {f.name for f in (ROOT / "app").glob("*.js")} - {"sw.js"}
        self.assertIn("native.js", shell)
        self.assertEqual(modules - set(shell), set(), "run python3 build_app.py")
        self.assertEqual(shell, build_app.shell_files(ROOT / "app"), "run python3 build_app.py")

    def test_list_follows_the_files(self):
        with tempfile.TemporaryDirectory() as d:
            app = pathlib.Path(d)
            for f in ("index.html", "app.css", "app.js", "new.js", "sw.js", "prep.json", "icon.svg", "icon-192.png",
                      "manifest.webmanifest", "shots/1.webp", "vendor/chess.js", "vendor/sf/sf.wasm", "vendor/sf/COPYING.txt"):
                (app / f).parent.mkdir(parents=True, exist_ok=True)
                (app / f).write_text("x")
            self.assertEqual(build_app.shell_files(app), [
                "./", "app.css", "app.js", "icon-192.png", "icon.svg", "index.html", "manifest.webmanifest", "new.js",
                "vendor/chess.js", "vendor/sf/sf.wasm"])

    def test_write_shell_replaces_only_the_list(self):
        sw = "const CACHE = 'chess-prep-x';\nconst SHELL = ['./', 'old.js',\n  'gone.js'];\nconst LOCAL = [1];\n"
        out = build_app.write_shell(sw, ["./", f"m{0}.js"] + [f"m{i}.js" for i in range(1, 10)])
        self.assertEqual(shell_in(out), ["./"] + [f"m{i}.js" for i in range(10)])
        self.assertTrue(out.startswith("const CACHE = 'chess-prep-x';\nconst SHELL = ['./', 'm0.js',"))
        self.assertTrue(out.endswith("];\nconst LOCAL = [1];\n"))
        self.assertEqual(build_app.write_shell(out, shell_in(out)), out, "same files, same text")


if __name__ == "__main__":
    unittest.main()
