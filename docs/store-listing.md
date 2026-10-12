# Store listing text

Text for the Play Console (and, later, App Store Connect). Written for the Play limits: short description 80 characters, full description 4,000.

## Fields

| Field | Value |
| --- | --- |
| App name | Checkmate Prep |
| Category | Education (or Sports) |
| Tags | Chess, Board, Strategy games, Training |
| Email | `contact@checkmateprep.com` |
| Website | `https://checkmateprep.com` |
| Privacy policy | `https://checkmateprep.com/privacy` |
| Data deletion | `https://checkmateprep.com/delete-account` |

## Short description (79 characters)

```
Prep for your next chess.com opponent: openings, traps, drills and a game plan.
```

## Full description

```
Know your next opponent before the game.

Checkmate Prep helps you prepare for games against specific people on chess.com. Enter your username and the opponents you want to prepare for, and the app builds a file on each of them from their recent public games.

WHAT YOU GET

• Opponent file: ratings, your head-to-head record, how they play, and the openings where they score badly. Every number is counted from real games, and small samples say how many games they rest on.
• Trap finder: Stockfish runs on your device over the positions they reach most often, and flags moves they keep repeating that the engine refutes, with the punishing line.
• Game plan: for white and for black, which opening to play, what they usually answer, the trap to aim for, and advice on time control and the clock.
• Explore: tap through an opening and see what they, or you, played next and how it scored.
• Drills: punish their traps, play prepared lines from memory, and solve positions from your own games. The engine checks your answer, so an equally good move counts.
• You: an engine review of your own games, with blunders by phase, converting wins and the clock. Your worst moments become puzzles.
• AI game plans (optional): Claude writes a plan in plain language for each opponent. This sends both usernames and their statistics to Anthropic.

HOW IT WORKS

Games come from chess.com's public data, so you need no chess.com login and no account with us. The analysis runs on your phone, with Stockfish 19. An account is optional: it only keeps your opponents, names, drill progress and results in step across your devices, and you can delete it at any time from Settings.

The source code is public at github.com/Checkmate-Prep/chess-coach. Stockfish is GPLv3.

Checkmate Prep is an independent app. It isn't affiliated with or endorsed by Chess.com.
```

Keep the text in step with the privacy page (`app/privacy.html`): the AI line and the "no account" claims must match what the code does.

## Release notes (internal testing)

```
<en-US>
First Android build of Checkmate Prep: opening prep, traps and drills for your games against the people you play on chess.com.
</en-US>
```
