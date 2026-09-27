"""Render the prep book (report.html) from profiles + the coach's notes in notes.py."""
import html, json, pathlib, re
import chess, chess.svg
try:
    from notes import ME, FRIENDS
except ImportError:  # hand-written prep lives on the ai-prep branch, not on main
    ME = FRIENDS = None

ROOT = pathlib.Path(__file__).parent
FIG = {"K": "♔", "Q": "♕", "R": "♖", "B": "♗", "N": "♘"}
BOARD_COLORS = {"square light": "#e4e9df", "square dark": "#7f9a86",
                "square light lastmove": "#e8d59a", "square dark lastmove": "#c2ad62"}


def fig(text):
    """Figurine notation for any SAN tokens inside a string."""
    return re.sub(r"\b([KQRBN])(?=[a-h1-8x]*[a-h][1-8])", lambda m: f"<span class=\"fg\">{FIG[m[1]]}</span>", text)


def board_svg(b, lastmove=None, flipped=False, arrows=()):
    svg = chess.svg.board(b, size=360, lastmove=lastmove, flipped=flipped, coordinates=True,
                          colors=BOARD_COLORS, arrows=list(arrows))
    return re.sub(r'^<svg ', '<svg class="board" ', svg)


def line_steps(moves, flipped):
    """Board after each ply of a move string."""
    b, steps = chess.Board(), [{"svg": board_svg(chess.Board(), flipped=flipped), "san": "Start"}]
    for i, san in enumerate(moves.split()):
        mv = b.parse_san(san)
        num = f"{i // 2 + 1}." if i % 2 == 0 else f"{i // 2 + 1}…"
        b.push(mv)
        steps.append({"svg": board_svg(b, lastmove=mv, flipped=flipped), "san": fig(num + san)})
    return steps


def movelist(moves, key_from=None):
    out, toks = [], moves.split()
    for i, san in enumerate(toks):
        num = f'<span class="mn">{i // 2 + 1}.</span>' if i % 2 == 0 else ""
        cls = "mv key" if key_from is not None and i >= key_from else "mv"
        out.append(f'{num}<button class="{cls}" data-ply="{i + 1}">{fig(san)}</button>')
    return " ".join(out)


def stepper(sid, line, flipped=False, key_from=None, caption=""):
    steps = line_steps(line, flipped)
    data = json.dumps([s["svg"] for s in steps])
    return f'''<figure class="stepper" id="{sid}" data-last="{len(steps) - 1}">
  <div class="board-wrap" aria-live="polite"></div>
  <figcaption>
    <div class="moves">{movelist(line, key_from)}</div>
    <div class="nav"><button class="btn" data-act="first" aria-label="First move">⏮</button><button class="btn" data-act="prev" aria-label="Previous move">◀</button><button class="btn" data-act="next" aria-label="Next move">▶</button><button class="btn" data-act="last" aria-label="Last move">⏭</button></div>
    {f'<p class="cap">{caption}</p>' if caption else ''}
  </figcaption>
  <script type="application/json">{data}</script>
</figure>'''


def puzzle(p, i):
    b = chess.Board(p["fen"])
    flipped = b.turn == chess.BLACK
    before = board_svg(b, flipped=flipped)
    best = b.parse_san(p["best"])
    played = b.parse_san(p["played"])
    after = board_svg(b, flipped=flipped, arrows=[chess.svg.Arrow(best.from_square, best.to_square, color="#2f7d57cc"),
                                                  chess.svg.Arrow(played.from_square, played.to_square, color="#b8433dcc")])
    side = "White" if b.turn else "Black"
    return f'''<article class="puzzle" id="pz{i}">
  <div class="pz-board"><div class="b-q">{before}</div><div class="b-a" hidden>{after}</div></div>
  <div class="pz-body">
    <p class="eyebrow">{html.escape(p["game"])}</p>
    <h4>{side} to move. {html.escape(p["prompt"])}</h4>
    <button class="btn reveal" aria-expanded="false">Show the answer</button>
    <div class="answer" hidden>
      <p><span class="good">{fig(p["best"])}</span> was the move. You played <span class="bad">{fig(p["played"])}</span> (−{p["loss"]} win-chance points).</p>
      <p>{fig(p["why"])}</p>
    </div>
  </div>
</article>'''


def pill(n, label):
    return f'<div class="stat"><span class="num">{n}</span><span class="lbl">{label}</span></div>'


def section_friend(key, f):
    p = json.load(open(ROOT / f"data/{key}.profile.json"))
    parts = [f'<section class="tab-panel" id="{f["anchor"]}" role="tabpanel" hidden>']
    parts.append(f'<header class="panel-head"><p class="eyebrow">Opponent file · chess.com/{key}</p><h2>{f["name"]}</h2><p class="lede">{fig(f["summary"])}</p></header>')
    parts.append('<div class="stats">' + "".join(pill(k, v) for k, v in f["stats"]) + "</div>")
    parts.append('<div class="grid2">')
    for title, items in (("How they play", f["style"]), ("Where they go wrong", f["weak"])):
        parts.append(f'<div class="card"><h3>{title}</h3><ul>' + "".join(f"<li>{fig(x)}</li>" for x in items) + "</ul></div>")
    parts.append("</div>")
    for i, plan in enumerate(f["plans"]):
        parts.append(f'<div class="plan"><div class="plan-text"><p class="eyebrow">{plan["eyebrow"]}</p><h3>{fig(plan["title"])}</h3>')
        parts.append("".join(f"<p>{fig(x)}</p>" for x in plan["body"]))
        if plan.get("table"):
            parts.append('<div class="tbl"><table><thead><tr><th>Line</th><th>Their games</th><th>Their score</th></tr></thead><tbody>'
                         + "".join(f'<tr><td class="mono">{fig(a)}</td><td class="n">{b}</td><td class="n">{c}</td></tr>' for a, b, c in plan["table"])
                         + "</tbody></table></div>")
        parts.append("</div>")
        parts.append(stepper(f"{key}-{i}", plan["line"], plan.get("flip", False), plan.get("key_from"), plan.get("caption", "")))
        parts.append("</div>")
    parts.append('<div class="card checklist"><h3>Game-day checklist</h3><ol>' + "".join(f"<li>{fig(x)}</li>" for x in f["checklist"]) + "</ol></div>")
    parts.append("</section>")
    return "\n".join(parts)


def section_me():
    p = json.load(open(ROOT / "data/slnyc.profile.json"))
    m = ME
    parts = ['<section class="tab-panel" id="you" role="tabpanel">']
    parts.append(f'<header class="panel-head"><p class="eyebrow">Player file · chess.com/slnyc</p><h2>You</h2><p class="lede">{fig(m["summary"])}</p></header>')
    parts.append('<div class="stats">' + "".join(pill(k, v) for k, v in m["stats"]) + "</div>")
    parts.append('<div class="grid2">')
    for title, items in (("Strengths", m["strengths"]), ("Weaknesses", m["weaknesses"])):
        parts.append(f'<div class="card"><h3>{title}</h3><ul>' + "".join(f"<li>{fig(x)}</li>" for x in items) + "</ul></div>")
    parts.append("</div>")
    parts.append('<h3 class="sub">Find the move: four moments from your own games</h3><p class="note">Each position is from one of your games. Find the move before you reveal the answer. The green arrow is the right move and the red arrow is what you played.</p>')
    parts.append('<div class="puzzles">' + "".join(puzzle(pz, i) for i, pz in enumerate(m["puzzles"])) + "</div>")
    parts.append('<div class="card checklist"><h3>Training plan</h3><ol>' + "".join(f"<li>{fig(x)}</li>" for x in m["training"]) + "</ol></div>")
    parts.append("</section>")
    return "\n".join(parts)


def section_refresh():
    return '''<section class="tab-panel" id="refresh" role="tabpanel" hidden>
<header class="panel-head"><p class="eyebrow">Before your next game</p><h2>Keep the file current</h2>
<p class="lede">Everything here is built from chess.com's public game archive and a local Stockfish 19 analysis. It lives in the <span class="mono">chess-coach</span> folder. Refresh it before a game, then ask Claude a question like "Etienne played 3.Nc3 against me last time. What now?"</p></header>
<div class="card"><h3>Commands</h3>
<pre class="code">python3 coach.py refresh               # you + Etienne + Greg
python3 coach.py refresh pepex654      # just Etienne
python3 coach.py explore gregmolin white "e4 c6 Nc3 d5"
python3 build_report.py                # rebuild this page</pre>
<p class="note">The explorer shows what a player chose next from any position and how they scored. Engine analysis is cached, so a refresh only analyzes games that are new.</p></div>
<div class="card"><h3>What the numbers mean</h3><ul>
<li><b>Blunder:</b> a move that drops your winning chances by 20 points or more on a 0–100 scale. That's roughly a piece, or a won position turning into an even one.</li>
<li><b>Mistake:</b> a move that drops them by 10–20 points.</li>
<li><b>Score:</b> points per game from that player's side (win = 1, draw = ½), as a percentage.</li>
<li><b>Sample:</b> last 12 months of games for Etienne and Greg. For each of them, the 150 most recent blitz, rapid and daily games went through the engine. For you, all 17 games since 2022.</li>
<li><b>Puzzles:</b> chess.com's public data only includes your puzzle rating, not the puzzles themselves. Your tactical drills come from your real games.</li>
</ul></div>
</section>'''


CSS = open(ROOT / "report.css").read()
JS = open(ROOT / "report.js").read()


def build():
    tabs = [("you", "You")] + [(f["anchor"], "vs " + f["name"]) for f in FRIENDS.values()] + [("refresh", "Refresh")]
    nav = "".join(f'<a role="tab" href="#{a}" data-tab="{a}" aria-selected="{str(i == 0).lower()}">{t}</a>' for i, (a, t) in enumerate(tabs))
    body = [section_me()] + [section_friend(k, f) for k, f in FRIENDS.items()] + [section_refresh()]
    page = f'''<meta charset="utf-8"><title>Chess Prep Book</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,500;0,700;1,500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>{CSS}</style>
<div class="wrap">
<header class="masthead">
  <p class="eyebrow">Prepared {ME["date"]} · Stockfish 19 · chess.com public archive</p>
  <h1>Chess Prep Book</h1>
  <p class="sub-h">Your games, Etienne's and Greg's, read by an engine and turned into a plan for your next game against each of them.</p>
  <nav class="tabs" role="tablist">{nav}</nav>
</header>
{"".join(body)}
<footer class="foot">Built from {ME["footer"]}.</footer>
</div>
<script>{JS}</script>'''
    (ROOT / "report.html").write_text(page)
    print("wrote report.html", len(page) // 1024, "KB")


if __name__ == "__main__":
    if ME is None:
        print("no notes.py (it lives on the ai-prep branch): skipping report.html")
    else:
        build()
