"""Run the pipeline tests, like `python3 -m unittest discover -s tests`.

With --summary FILE, also write a Markdown summary (CI shows it on the run page and in the PR comment).
Exits non-zero when a test fails.
"""
import argparse, pathlib, sys, time, unittest
from collections import defaultdict

HERE = pathlib.Path(__file__).resolve().parent


def flatten(suite):
    for t in suite:
        yield from flatten(t) if isinstance(t, unittest.TestSuite) else [t]


def markdown(tests, result, seconds):
    status = {}
    for kind, items in (("fail", result.failures), ("fail", result.errors), ("skip", result.skipped)):
        for t, _ in items:
            status[t.id()] = kind
    groups = defaultdict(lambda: {"pass": 0, "fail": 0, "skip": 0})
    for t in tests:
        groups[type(t).__name__][status.get(t.id(), "pass")] += 1
    n = {k: sum(g[k] for g in groups.values()) for k in ("pass", "fail", "skip")}

    md = f"### {'❌' if n['fail'] else '✅'} Pipeline (Python): {n['pass']} passed"
    md += f" · {n['fail']} failed" if n["fail"] else ""
    md += f" · {n['skip']} skipped" if n["skip"] else ""
    md += f" · {seconds:.1f} s\n\n"
    for t, trace in result.failures + result.errors:
        md += f"**❌ {t.id().split('.', 1)[-1]}**\n\n```\n{trace.strip()[-1500:]}\n```\n\n"
    for t, reason in result.skipped:
        md += f"Skipped `{t.id().split('.', 1)[-1]}`: {reason}\n\n"
    md += "<details><summary>Results by test group</summary>\n\n| Group | Passed | Failed | Skipped |\n|---|---:|---:|---:|\n"
    for name, g in sorted(groups.items()):
        md += f"| `{name}` | {g['pass']} | {g['fail'] or '–'} | {g['skip'] or '–'} |\n"
    return md + "\n</details>\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--summary", help="write a Markdown summary to this file")
    args = ap.parse_args()
    suite = unittest.defaultTestLoader.discover(str(HERE), top_level_dir=str(HERE))
    tests = list(flatten(suite))
    start = time.time()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if args.summary:
        pathlib.Path(args.summary).write_text(markdown(tests, result, time.time() - start))
    sys.exit(0 if result.wasSuccessful() else 1)


if __name__ == "__main__":
    main()
