"""Tests for the Python pipeline, on synthetic games in tests/fixtures (never data/, which is private).

Run: python3 -m unittest discover tests
"""
import contextlib, importlib.util, io, json, pathlib, shutil, sys, tempfile, unittest
from unittest import mock

import chess, chess.engine

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIX = pathlib.Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(ROOT))


def load(name):
    """Import a pipeline script by path (profile.py would otherwise clash with the stdlib module)."""
    spec = importlib.util.spec_from_file_location(f"pipeline_{name}", ROOT / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


explore, profile, build_app, analyze, coach, fetch = (load(n) for n in ("explore", "profile", "build_app", "analyze", "coach", "fetch"))
GAMES = json.loads((FIX / "games.json").read_text())
PARITY = json.loads((FIX / "parity.json").read_text())


class TempRoot(unittest.TestCase):
    """A throwaway project root with data/testplayer.json, patched into the given modules."""
    modules = ()

    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        (self.root / "data").mkdir()
        (self.root / "data/testplayer.json").write_text(json.dumps(GAMES))
        for m in self.modules:
            p = mock.patch.object(m, "ROOT", self.root)
            p.start()
            self.addCleanup(p.stop)


class TestParity(unittest.TestCase):
    """The app (JS) and the pipeline (Python) must agree; tests/*.test.mjs check the same values."""

    def test_sans_of(self):
        for case in PARITY["sans"]:
            self.assertEqual(explore.sans_of(case["pgn"]), case["sans"])

    def test_win_prob(self):
        for cp, want in PARITY["winProb"]:
            self.assertAlmostEqual(analyze.win_prob(cp), want, places=6)

    def test_draw_results(self):
        self.assertEqual(profile.DRAWS, explore.DRAWS)


class TestProfileHelpers(unittest.TestCase):
    def test_score(self):
        self.assertEqual([profile.score(r) for r in ("win", "agreed", "stalemate", "timeout", "resigned")], [1, 0.5, 0.5, 0, 0])

    def test_opening_name(self):
        self.assertEqual(profile.opening_name({"eco": "https://www.chess.com/openings/Sicilian-Defense-Open-Najdorf-Variation-6.Be3"}), "Sicilian Defense Open")
        self.assertEqual(profile.opening_name({"eco": "https://www.chess.com/openings/Kings-Pawn-Opening/"}), "Kings Pawn Opening")
        self.assertEqual(profile.opening_name({}), "?")

    def test_phase(self):
        self.assertEqual(profile.phase(20, 10), "opening")
        self.assertEqual(profile.phase(21, 12), "endgame")
        self.assertEqual(profile.phase(21, 13), "middlegame")

    def test_rec(self):
        self.assertEqual(profile.rec([1, 0, 0.5, 1]), {"n": 4, "score": 62})  # Python rounds 62.5 to even
        self.assertEqual(profile.rec([]), {"n": 0, "score": None})


class TestProfileBuild(TempRoot):
    modules = (profile,)

    def analysis(self):
        """Engine data for game 1 (TestPlayer has White)."""
        m = lambda ply, san, best, before, after, loss, clock, pieces: dict(
            ply=ply, san=san, best=best, before=before, after=after, wp_loss=loss, clock=clock, pieces=pieces,
            fen=f"fen{ply} w - - 0 1")
        return {GAMES[0]["url"]: [
            m(1, "e4", "d4", 20, -300, 25, 170, 32),      # own blunder, normal clock
            m(2, "e5", "e5", 300, -250, 30, 170, 32),     # their blunder ...
            m(3, "Nf3", "Nf3", 350, 350, 0, 10, 32),      # ... punished; low clock; +3.5 peak
            m(4, "Nc6", "Nc6", -350, -350, 0, 160, 32),
            m(21, "Qh5", "Nxe5", 300, 50, 22, 12, 10),    # endgame blunder that missed a capture, low clock
        ]}

    def test_without_engine_data(self):
        p = profile.build("testplayer")
        self.assertEqual(p["games"], 4)  # the chess960 game is left out
        self.assertEqual(p["engine_games"], 0)
        self.assertEqual(p["by_time_class"], {"blitz": {"n": 2, "score": 100}, "rapid": {"n": 2, "score": 25}})
        self.assertEqual(p["current_rating"], {"blitz": 1210, "rapid": 1180})
        self.assertEqual(p["rating_start_of_window"], {"blitz": 1205, "rapid": 1180})
        self.assertEqual(p["white_first_move"], [("e4", {"n": 2, "score": 75})])
        self.assertEqual(p["black_replies"], {})
        self.assertEqual(p["win_methods"], {"resigned": 1, "checkmated": 1})
        self.assertEqual(p["loss_methods"], {"timeout": 1})
        self.assertEqual(p["castling"], {"kingside": 1, "queenside": 1, "never(>15 moves)": 0, "avg_castle_move": 5.0})
        self.assertEqual(p["score_by_length"], {"short(<25)": {"n": 4, "score": 62}})
        self.assertTrue((self.root / "data/testplayer.profile.json").exists())

    def test_with_engine_data(self):
        (self.root / "data/testplayer.analysis.json").write_text(json.dumps(self.analysis()))
        e = profile.build("testplayer")["engine"]
        self.assertEqual(e["phases"], {
            "opening": {"moves": 2, "avg_wp_loss": 12.5, "blunders_per_100": 50.0, "mistakes_per_100": 0.0},
            "endgame": {"moves": 1, "avg_wp_loss": 22.0, "blunders_per_100": 100.0, "mistakes_per_100": 0.0},
        })
        self.assertEqual(e["blunders_per_100_time_pressure"], {"low": 50.0, "normal": 100.0})
        self.assertEqual(e["moves_in_time_pressure_pct"], 67)
        self.assertEqual((e["punished_opp_blunders_pct"], e["opp_blunders_faced"]), (100, 1))
        self.assertEqual((e["converted_winning_pct"], e["winning_games"]), (100, 1))
        self.assertEqual((e["saved_losing_pct"], e["losing_games"]), (None, 0))
        self.assertEqual(e["blunders_that_missed_a_capture_pct"], 50)
        self.assertEqual([b["ply"] for b in e["worst_blunders"]], [1, 21])
        self.assertEqual(e["repeated_early_mistakes"], [])
        self.assertEqual(e["total_moves"], 3)


class TestAppTrees(TempRoot):
    modules = (build_app,)

    def test_tree_counts_and_last_game(self):
        t, last = build_app.tree("testplayer", "white")
        self.assertEqual(last, 1780000400)
        self.assertEqual((t["n"], t["p"]), (2, 3))  # a win (2) and a draw (1)
        e4 = t["c"]["e4"]
        self.assertEqual((e4["n"], e4["p"]), (2, 3))
        self.assertEqual({k: (v["n"], v["p"]) for k, v in e4["c"].items()}, {"e5": (1, 2), "c5": (1, 1)})
        b, _ = build_app.tree("testplayer", "black")
        self.assertEqual((b["n"], b["p"]), (2, 2))

    def test_prune_keeps_early_plies_and_repeated_branches(self):
        t, _ = build_app.tree("testplayer", "white")
        d6 = t["c"]["e4"]["c"]["c5"]["c"]["Nf3"]["c"]["d6"]  # ply 4 survives with one game
        self.assertNotIn("c", d6)                            # ply 5+ single-game branches are dropped
        leaf = {"n": 2, "p": 2, "c": {}}
        deep = {"n": 3, "p": 3, "c": {"a": {"n": 3, "p": 3, "c": {"b": leaf, "c": {"n": 1, "p": 0, "c": {}}}}}}
        self.assertEqual(build_app.prune(deep, depth=4), {"n": 3, "p": 3, "c": {"a": {"n": 3, "p": 3, "c": {"b": {"n": 2, "p": 2}}}}})

    def test_write_prep_has_what_the_app_reads(self):
        shutil.copy(self.root / "data/testplayer.json", self.root / "data/slnyc.json")
        friend = {"name": "Test", "summary": "s", "stats": [], "style": [], "weak": [], "checklist": [],
                  "plans": [{"title": "t", "body": "b", "extra": "dropped"}]}
        me = {"date": "1 Jan 2026", "summary": "s", "stats": [], "strengths": [], "weaknesses": [], "puzzles": [], "training": []}
        with mock.patch.object(build_app, "APP", self.root / "app"), mock.patch.object(build_app, "FRIENDS", {"testplayer": friend}), \
                mock.patch.object(build_app, "ME", me):
            build_app.write_prep()
            prep = json.loads((self.root / "app/prep.json").read_text())
        self.assertEqual(set(prep), {"built", "me", "friends"})
        self.assertEqual(set(prep["me"]["trees"]), {"white", "black"})
        f = prep["friends"][0]
        self.assertEqual(f["user"], "testplayer")
        self.assertEqual(f["last_game"], 1780000400)
        self.assertEqual(set(f["plans"][0]), {"eyebrow", "title", "body", "table", "line", "flip", "key_from", "caption", "watch"})

    def test_without_notes_prep_is_empty(self):
        with mock.patch.object(build_app, "APP", self.root / "app"), mock.patch.object(build_app, "ME", None), \
                mock.patch.object(build_app, "stamp"):
            build_app.main()
            prep = json.loads((self.root / "app/prep.json").read_text())
        self.assertEqual(prep, {"built": None, "me": None, "friends": []})

    def test_stamp_versions_the_cache_by_content(self):
        app = self.root / "app"
        app.mkdir()
        (app / "sw.js").write_text("const CACHE = 'chess-prep-old';\nself.x = 1;\n")
        (app / "app.js").write_text("one")
        (app / "prep.json").write_text("{}")
        with mock.patch.object(build_app, "APP", app), contextlib.redirect_stdout(io.StringIO()):
            build_app.stamp()
            first = (app / "sw.js").read_text()
            build_app.stamp()
            self.assertEqual((app / "sw.js").read_text(), first, "same content, same cache name")
            (app / "app.js").write_text("two")
            build_app.stamp()
        self.assertRegex(first, r"const CACHE = 'chess-prep-[0-9a-f]{10}';\nself.x = 1;")
        self.assertNotEqual((app / "sw.js").read_text(), first)
        self.assertIn("export const PIECES", (app / "pieces.js").read_text())

    def test_main_keeps_published_prep_without_local_data(self):
        with mock.patch.object(build_app, "write_prep") as wp, mock.patch.object(build_app, "stamp") as st, \
                mock.patch.object(build_app, "ME", {}), contextlib.redirect_stdout(io.StringIO()) as out:
            build_app.main()
        wp.assert_not_called()
        st.assert_called_once()
        self.assertIn("keeping app/prep.json", out.getvalue())


class TestExplore(TempRoot):
    modules = (explore,)

    def test_next_moves_and_scores(self):
        with mock.patch.object(sys, "argv", ["explore.py", "testplayer", "white", "e4"]), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            explore.main()
        lines = out.getvalue().splitlines()
        self.assertEqual(lines[0], "testplayer as white after 'e4': 2 games")
        self.assertEqual([l.split()[0] for l in lines[1:]], ["e5", "c5"])
        self.assertIn("scores 100%", lines[1])
        self.assertIn("scores  50%", lines[2])


class TestAnalyze(unittest.TestCase):
    def test_score_cp(self):
        info = {"score": chess.engine.PovScore(chess.engine.Cp(50), chess.WHITE)}
        self.assertEqual(analyze.score_cp(info, chess.BLACK), -50)
        info = {"score": chess.engine.PovScore(chess.engine.Mate(2), chess.WHITE)}
        self.assertEqual(analyze.score_cp(info, chess.WHITE), 9998)

    @unittest.skipUnless(pathlib.Path(analyze.ENGINE).exists(), "native Stockfish not downloaded (bin/)")
    def test_analyze_game_with_native_engine(self):
        with mock.patch.object(analyze, "NODES", 2000):
            url, moves = analyze.analyze_game(GAMES[0])
        self.assertEqual(url, GAMES[0]["url"])
        self.assertEqual([m["san"] for m in moves], PARITY["sans"][0]["sans"])
        self.assertEqual([m["ply"] for m in moves], list(range(1, 9)))
        self.assertEqual(moves[0]["fen"], chess.STARTING_FEN)
        self.assertEqual((moves[0]["clock"], moves[7]["clock"]), (179, 150.5))
        self.assertTrue(all(m["wp_loss"] >= 0 for m in moves))


class TestCoach(unittest.TestCase):
    def test_refresh_runs_the_pipeline(self):
        with mock.patch.object(coach, "run") as run:
            coach.refresh(coach.ME)
            coach.refresh("someone")
        self.assertEqual([c.args for c in run.call_args_list], [
            ("fetch.py", coach.ME), ("analyze.py", coach.ME, 150, coach.SLOW), ("profile.py", coach.ME),
            ("fetch.py", "someone", "12"), ("analyze.py", "someone", 150, coach.SLOW), ("profile.py", "someone"),
        ])


class TestFetch(unittest.TestCase):
    def test_get_retries_then_succeeds(self):
        answers = [OSError("down"), OSError("down"), io.BytesIO(b'{"ok": 1}')]
        def urlopen(req, timeout):
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return a
        with mock.patch.object(fetch.urllib.request, "urlopen", urlopen), mock.patch.object(fetch.time, "sleep") as sleep:
            self.assertEqual(fetch.get("https://example.test"), {"ok": 1})
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [2, 4])

    def test_get_gives_up_after_four_tries(self):
        def urlopen(req, timeout):
            raise OSError("down")
        with mock.patch.object(fetch.urllib.request, "urlopen", urlopen), mock.patch.object(fetch.time, "sleep"):
            with self.assertRaises(RuntimeError):
                fetch.get("https://example.test")


if __name__ == "__main__":
    unittest.main()
