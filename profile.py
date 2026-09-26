"""Build a player profile (style, openings, weaknesses) from games + engine analysis.

Usage: python3 profile.py <user>   -> writes data/<user>.profile.json and prints a summary
"""
import io, json, pathlib, re, sys
from collections import Counter, defaultdict
import chess, chess.pgn

ROOT = pathlib.Path(__file__).parent
BLUNDER, MISTAKE = 20, 10  # win-probability points lost
DRAWS = {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}


def score(result):
    return 1 if result == "win" else 0.5 if result in DRAWS else 0


def opening_name(g):
    eco = g.get("eco", "").rstrip("/").split("/")[-1]
    name = re.sub(r"-\d.*$", "", eco).replace("-", " ")
    # collapse to family: "Sicilian Defense Alapin Variation" -> first 3 words
    return " ".join(name.split()[:3]) or "?"


def phase(ply, pieces):
    if ply <= 20:
        return "opening"
    return "endgame" if pieces <= 12 else "middlegame"


def rec(scores):
    n = len(scores)
    return {"n": n, "score": round(100 * sum(scores) / n) if n else None}


def build(user):
    games = json.load(open(ROOT / f"data/{user}.json"))
    games = [g for g in games if g.get("rules") == "chess" and "pgn" in g]
    ap = ROOT / f"data/{user}.analysis.json"
    analysis = json.load(open(ap)) if ap.exists() else {}

    by_class = defaultdict(list)
    first_move_w, reply_b = defaultdict(list), defaultdict(lambda: defaultdict(list))
    openings = {"white": defaultdict(list), "black": defaultdict(list)}
    lines = {"white": defaultdict(list), "black": defaultdict(list)}
    endings = {"win": Counter(), "loss": Counter()}
    castle = Counter()
    length_scores = defaultdict(list)
    ratings = defaultdict(list)

    # engine-derived
    ph = defaultdict(lambda: {"moves": 0, "loss": 0.0, "blunders": 0, "mistakes": 0})
    time_pressure = {"low": [0, 0], "normal": [0, 0]}  # [moves, blunders]
    punish = [0, 0]  # [opp blunders faced, punished]
    convert = [0, 0]  # [games reached +3, won]
    save = [0, 0]  # [games reached -3, not lost]
    missed_capture = 0
    repeated = Counter()  # (fen, san) of own early mistakes
    blunder_examples = []
    engine_games = 0

    for g in games:
        col = "white" if g["white"]["username"].lower() == user else "black"
        me, opp = g[col], g["black" if col == "white" else "white"]
        s = score(me["result"])
        by_class[g["time_class"]].append(s)
        if g.get("rated"):
            ratings[g["time_class"]].append((g["end_time"], me["rating"]))
        openings[col][opening_name(g)].append(s)
        if s == 1:
            endings["win"][opp["result"]] += 1
        elif s == 0:
            endings["loss"][me["result"]] += 1

        game = chess.pgn.read_game(io.StringIO(g["pgn"]))
        board, sans, my_castle = game.board(), [], None
        for i, mv in enumerate(game.mainline_moves()):
            if i < 8:
                sans.append(board.san(mv))
            if board.is_castling(mv) and (board.turn == chess.WHITE) == (col == "white") and not my_castle:
                my_castle = ("O-O" if board.is_kingside_castling(mv) else "O-O-O", i // 2 + 1)
            board.push(mv)
        nmoves = board.fullmove_number
        length_scores["short(<25)" if nmoves < 25 else "medium" if nmoves < 45 else "long(45+)"].append(s)
        if my_castle:
            castle[my_castle[0]] += 1
            castle["_moves"] += my_castle[1]
        elif nmoves > 15:
            castle["never"] += 1
        if sans:
            if col == "white":
                first_move_w[sans[0]].append(s)
            elif len(sans) > 1:
                reply_b[sans[0]][sans[1]].append(s)
            lines[col][" ".join(sans[:6])].append(s)

        moves = analysis.get(g["url"])
        if not moves:
            continue
        engine_games += 1
        tc = g["time_control"].split("+")[0]
        base = int(tc) if tc.isdigit() else None
        mine = 0 if col == "white" else 1
        peak = min_ = 0
        for m in moves:
            is_mine = (m["ply"] - 1) % 2 == mine
            if is_mine:
                peak, min_ = max(peak, m["before"]), min(min_, m["before"])
                p = ph[phase(m["ply"], m["pieces"])]
                p["moves"] += 1
                p["loss"] += m["wp_loss"]
                p["blunders"] += m["wp_loss"] >= BLUNDER
                p["mistakes"] += MISTAKE <= m["wp_loss"] < BLUNDER
                if base and m["clock"] is not None:
                    tp = time_pressure["low" if m["clock"] < max(10, 0.1 * base) else "normal"]
                    tp[0] += 1
                    tp[1] += m["wp_loss"] >= BLUNDER
                if m["wp_loss"] >= MISTAKE and m["ply"] <= 24:
                    repeated[(m["fen"].rsplit(" ", 2)[0], m["san"])] += 1
                if m["wp_loss"] >= BLUNDER:
                    if m["best"] and "x" in m["best"] and "x" not in m["san"]:
                        missed_capture += 1
                    blunder_examples.append({"url": g["url"], "ply": m["ply"], "played": m["san"],
                                             "best": m["best"], "loss": m["wp_loss"], "fen": m["fen"],
                                             "tc": g["time_class"]})
            else:
                # opponent just blundered -> did we punish on our next move?
                nxt = next((x for x in moves if x["ply"] == m["ply"] + 1), None)
                if m["wp_loss"] >= BLUNDER and nxt and m["after"] < -200:
                    punish[0] += 1
                    punish[1] += nxt["wp_loss"] < MISTAKE
        if peak >= 300:
            convert[0] += 1
            convert[1] += s == 1
        if min_ <= -300:
            save[0] += 1
            save[1] += s > 0

    def top(d, k=8, min_n=3):
        items = [(name, rec(v)) for name, v in d.items() if len(v) >= min_n]
        return sorted(items, key=lambda x: -x[1]["n"])[:k]

    pct = lambda a, b: round(100 * a / b) if b else None
    total_mine = sum(p["moves"] for p in ph.values())
    prof = {
        "user": user,
        "games": len(games),
        "engine_games": engine_games,
        "by_time_class": {k: rec(v) for k, v in by_class.items()},
        "current_rating": {k: sorted(v)[-1][1] for k, v in ratings.items()},
        "rating_start_of_window": {k: sorted(v)[0][1] for k, v in ratings.items()},
        "white_first_move": top(first_move_w, 5, 1),
        "black_replies": {fm: top(r, 4, 1) for fm, r in reply_b.items() if sum(map(len, r.values())) >= 3},
        "openings_white": top(openings["white"], 10),
        "openings_black": top(openings["black"], 10),
        "lines_white": top(lines["white"], 8),
        "lines_black": top(lines["black"], 8),
        "win_methods": dict(endings["win"]),
        "loss_methods": dict(endings["loss"]),
        "castling": {"kingside": castle["O-O"], "queenside": castle["O-O-O"], "never(>15 moves)": castle["never"],
                     "avg_castle_move": round(castle["_moves"] / max(1, castle["O-O"] + castle["O-O-O"]), 1)},
        "score_by_length": {k: rec(v) for k, v in length_scores.items()},
        "engine": {
            "phases": {k: {"moves": v["moves"], "avg_wp_loss": round(v["loss"] / v["moves"], 1) if v["moves"] else None,
                           "blunders_per_100": round(100 * v["blunders"] / v["moves"], 1) if v["moves"] else None,
                           "mistakes_per_100": round(100 * v["mistakes"] / v["moves"], 1) if v["moves"] else None}
                       for k, v in ph.items()},
            "blunders_per_100_time_pressure": {k: round(100 * b / n, 1) if n else None for k, (n, b) in time_pressure.items()},
            "moves_in_time_pressure_pct": pct(time_pressure["low"][0], time_pressure["low"][0] + time_pressure["normal"][0]),
            "punished_opp_blunders_pct": pct(punish[1], punish[0]), "opp_blunders_faced": punish[0],
            "converted_winning_pct": pct(convert[1], convert[0]), "winning_games": convert[0],
            "saved_losing_pct": pct(save[1], save[0]), "losing_games": save[0],
            "blunders_that_missed_a_capture_pct": pct(missed_capture, len(blunder_examples)),
            "repeated_early_mistakes": [{"fen": f, "move": s, "times": n} for (f, s), n in repeated.most_common(8) if n >= 2],
            "worst_blunders": sorted(blunder_examples, key=lambda b: -b["loss"])[:12],
            "total_moves": total_mine,
        },
    }
    (ROOT / f"data/{user}.profile.json").write_text(json.dumps(prof, indent=1))
    return prof


if __name__ == "__main__":
    p = build(sys.argv[1].lower())
    out = {k: v for k, v in p.items() if k != "engine"}
    out["engine"] = {k: v for k, v in p["engine"].items() if k != "worst_blunders"}
    print(json.dumps(out, indent=1))
