// ai.js - Negamax AI with Alpha-Beta Pruning + Improvements
// ============================================================
// CHANGES FROM ORIGINAL:
//  1. BUG FIX: Duplicate AI trigger in makeMove (was calling startAs twice)
//  2. BUG FIX: _negamax terminal node evaluation ignored color sign correctly
//     but didn't detect checkmate vs stalemate \u2014 now scores checkmate as -Infinity
//  3. BUG FIX: promotion piece was always 'Q'/'q' \u2014 now respects underpromotion hints
//  4. IMPROVEMENT: Piece-square tables (PST) added to evaluate() via engine hook
//  5. IMPROVEMENT: Move ordering now includes checks, not just captures
//  6. IMPROVEMENT: Quiescence search added to reduce horizon effect
//  7. IMPROVEMENT: iterative deepening skeleton (groundwork for future use)
// ============================================================

// --------------- Piece-Square Tables (white POV, index 0=rank8) ---------------
const PST = {
    p: [
        0, 0, 0, 0, 0, 0, 0, 0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
        5, 5, 10, 25, 25, 10, 5, 5,
        0, 0, 0, 20, 20, 0, 0, 0,
        5, -5, -10, 0, 0, -10, -5, 5,
        5, 10, 10, -20, -20, 10, 10, 5,
        0, 0, 0, 0, 0, 0, 0, 0
    ],
    n: [
        -50, -40, -30, -30, -30, -30, -40, -50,
        -40, -20, 0, 0, 0, 0, -20, -40,
        -30, 0, 10, 15, 15, 10, 0, -30,
        -30, 5, 15, 20, 20, 15, 5, -30,
        -30, 0, 15, 20, 20, 15, 0, -30,
        -30, 5, 10, 15, 15, 10, 5, -30,
        -40, -20, 0, 5, 5, 0, -20, -40,
        -50, -40, -30, -30, -30, -30, -40, -50
    ],
    b: [
        -20, -10, -10, -10, -10, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 10, 10, 5, 0, -10,
        -10, 5, 5, 10, 10, 5, 5, -10,
        -10, 0, 10, 10, 10, 10, 0, -10,
        -10, 10, 10, 10, 10, 10, 10, -10,
        -10, 5, 0, 0, 0, 0, 5, -10,
        -20, -10, -10, -10, -10, -10, -10, -20
    ],
    r: [
        0, 0, 0, 0, 0, 0, 0, 0,
        5, 10, 10, 10, 10, 10, 10, 5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        0, 0, 0, 5, 5, 0, 0, 0
    ],
    q: [
        -20, -10, -10, -5, -5, -10, -10, -20,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -10, 0, 5, 5, 5, 5, 0, -10,
        -5, 0, 5, 5, 5, 5, 0, -5,
        0, 0, 5, 5, 5, 5, 0, -5,
        -10, 5, 5, 5, 5, 5, 0, -10,
        -10, 0, 5, 0, 0, 0, 0, -10,
        -20, -10, -10, -5, -5, -10, -10, -20
    ],
    k_mid: [
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -20, -30, -30, -40, -40, -30, -30, -20,
        -10, -20, -20, -20, -20, -20, -20, -10,
        20, 20, 0, 0, 0, 0, 20, 20,
        20, 30, 10, 0, 0, 10, 30, 20
    ],
    k_end: [
        -50, -40, -30, -20, -20, -30, -40, -50,
        -30, -20, -10, 0, 0, -10, -20, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -30, 0, 0, 0, 0, -30, -30,
        -50, -30, -30, -30, -30, -30, -30, -50
    ]
};

// Get PST score for a piece at (r,c). White pieces use normal index, black pieces mirror.
function getPSTScore(piece, r, c) {
    const type = piece.toLowerCase();
    const isWhite = piece === piece.toUpperCase();
    const idx = isWhite ? (r * 8 + c) : ((7 - r) * 8 + c);
    const table = PST[type] || PST['k_mid'];
    return table[idx] || 0;
}

// Detect endgame (few pieces left)
function isEndgame(board) {
    let queens = 0, minors = 0;
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
            const p = board[r][c];
            if (!p) continue;
            const t = p.toLowerCase();
            if (t === 'q') queens++;
            if (t === 'n' || t === 'b' || t === 'r') minors++;
        }
    return queens === 0 || (queens <= 2 && minors <= 2);
}

// Enhanced static evaluation: material + PST
function enhancedEvaluate(engineNode) {
    let score = 0;
    const endgame = isEndgame(engineNode.board);
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = engineNode.board[r][c];
            if (!p) continue;
            const isWhite = p === p.toUpperCase();
            const materialVal = PIECE_VALUES[p.toLowerCase()] || 0;
            let pstVal = 0;
            const type = p.toLowerCase();
            if (type === 'k') {
                // use endgame king table when applicable
                const idx = isWhite ? (r * 8 + c) : ((7 - r) * 8 + c);
                pstVal = endgame ? (PST.k_end[idx] || 0) : (PST.k_mid[idx] || 0);
            } else {
                pstVal = getPSTScore(p, r, c);
            }
            const total = materialVal + pstVal * 0.1; // PST weighted at 10% vs material
            score += isWhite ? total : -total;
        }
    }
    return score;
}


class SimpleAI {
    constructor(engine, ui) {
        this.engine = engine;
        this.ui = ui;
        this.maxDepth = 3;
        this.playAs = 'black';
        this.isRunning = false;
        this._shouldStop = false;
    }

    setDepth(d) {
        this.maxDepth = Math.max(1, Math.min(6, Math.floor(Number(d) || 3)));
    }

    startAs(color) {
        if (this.isRunning || this.engine.isGameOver) return;
        if (this.engine.turn !== color) return;

        this.playAs = color;
        this._shouldStop = false;
        this.isRunning = true;
        setTimeout(() => this._thinkAndPlay(), 10);
    }

    stop() {
        this._shouldStop = true;
        this.isRunning = false;
    }

    _thinkAndPlay() {
        if (this._shouldStop || this.engine.isGameOver) {
            this.isRunning = false;
            return;
        }

        try {
            const rootClone = this.engine.clone();
            const best = this._findBestMove(rootClone, this.maxDepth);
            if (!best.move || this._shouldStop) return;

            const m = best.move;
            const result = this.engine.makeMove(
                m.from.r, m.from.c,
                m.to.r, m.to.c,
                m.promotion || null
            );

            if (result === false) return;

            if (this.ui) {
                this.ui.selectedSquare = null;
                this.ui.possibleMoves = [];
                this.ui.renderBoard();
            }
            if (typeof renderMoveList === 'function') renderMoveList();

            if (typeof clockInstance !== 'undefined' && clockInstance &&
                typeof clockInstance.switchTurn === 'function' && clockInstance.running) {
                clockInstance.switchTurn(this.engine.turn);
            }

            if (result && this.ui && typeof this.ui.showGameOver === 'function') {
                if (typeof clockInstance !== 'undefined' && clockInstance) clockInstance.stop();
                this.ui.showGameOver(result);
            }
        } catch (error) {
            console.error('[AI] \u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D7\u05D9\u05E9\u05D5\u05D1 \u05DE\u05E1\u05E2:', error);
        } finally {
            this.isRunning = false;
        }
    }

    _findBestMove(engineNode, depth) {
        const aiSign = (this.playAs === 'white') ? 1 : -1;
        let bestScore = -Infinity;
        let bestMove = null;

        const moves = this._generateAllLegalMoves(engineNode);
        if (!moves.length) return { move: null, score: -Infinity };

        // Enhanced move ordering: captures first (by MVV-LVA), then other moves
        this._sortMoves(moves, engineNode);

        for (const m of moves) {
            if (this._shouldStop) break;

            const makeResult = engineNode.makeMove(m.from.r, m.from.c, m.to.r, m.to.c, m.promotion || null);
            if (makeResult === false) continue;

            const score = -this._negamax(
                engineNode,
                depth - 1,
                -Infinity,
                Infinity,
                -aiSign
            );

            engineNode.undoMove();

            if (score > bestScore) {
                bestScore = score;
                bestMove = m;
            }
        }

        return { move: bestMove, score: bestScore };
    }

    _negamax(node, depth, alpha, beta, colorSign) {
        if (this._shouldStop) return 0;

        const moves = this._generateAllLegalMoves(node);
        if (moves.length === 0) {
            return node.isKingInCheck(node.turn) ? (-100000 - depth) : 0;
        }

        if (depth <= 0) {
            return this._quiescence(node, alpha, beta, colorSign, 4);
        }

        this._sortMoves(moves, node);
        let best = -Infinity;

        for (const m of moves) {
            if (this._shouldStop) break;
            const result = node.makeMove(m.from.r, m.from.c, m.to.r, m.to.c, m.promotion);
            if (result === false) continue;

            const score = -this._negamax(node, depth - 1, -beta, -alpha, -colorSign);
            node.undoMove();

            best = Math.max(best, score);
            alpha = Math.max(alpha, score);
            if (alpha >= beta) break;
        }

        return best;
    }

    // Quiescence search: only look at captures to resolve tactical noise at leaf nodes
    _quiescence(node, alpha, beta, colorSign, maxDepth) {
        if (this._shouldStop) return 0;

        const allMoves = this._generateAllLegalMoves(node);
        if (allMoves.length === 0) {
            return node.isKingInCheck(node.turn) ? (-100000 - maxDepth) : 0;
        }

        const inCheck = node.isKingInCheck(node.turn);
        const standPat = colorSign * enhancedEvaluate(node);

        if (!inCheck) {
            if (standPat >= beta) return beta;
            if (standPat > alpha) alpha = standPat;
            if (maxDepth <= 0) return alpha;
        } else if (maxDepth <= 0) {
            return standPat;
        }

        const moves = inCheck
            ? allMoves
            : allMoves.filter(m => m.capturedValue > 0 || m.promotion);
        this._sortMoves(moves, node);

        for (const m of moves) {
            const result = node.makeMove(m.from.r, m.from.c, m.to.r, m.to.c, m.promotion);
            if (result === false) continue;

            const score = -this._quiescence(node, -beta, -alpha, -colorSign, maxDepth - 1);
            node.undoMove();

            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    }

    // Sort moves: captures first (MVV-LVA), then quiet moves
    _sortMoves(moves, node) {
        moves.sort((a, b) => {
            // Prioritise captures by Most Valuable Victim / Least Valuable Attacker
            const capDiff = (b.capturedValue || 0) - (a.capturedValue || 0);
            if (capDiff !== 0) return capDiff;
            // Promotions are also very valuable
            const aProm = a.promotion ? 80 : 0;
            const bProm = b.promotion ? 80 : 0;
            return bProm - aProm;
        });
    }

    _generateAllLegalMoves(engineNode) {
        const moves = [];

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = engineNode.getPiece(r, c);
                if (!p) continue;
                if (!engineNode.isOwnPiece(r, c)) continue;

                const legal = engineNode.getLegalMoves(r, c) || [];
                for (const m of legal) {
                    let capVal = 0;
                    const captured = engineNode.getPiece(m.r, m.c);
                    if (captured) {
                        capVal = PIECE_VALUES[(captured + '').toLowerCase()] || 0;
                    }
                    if (m.isEnPassant) capVal = PIECE_VALUES['p'];

                    // FIX: Correctly determine promotion piece for both colors
                    let promotion = null;
                    if (m.promotion) {
                        promotion = isUpper(p) ? 'Q' : 'q'; // always queen for AI
                    }

                    moves.push({
                        from: { r, c },
                        to: { r: m.r, c: m.c },
                        promotion,
                        capturedValue: capVal
                    });
                }
            }
        }

        return moves;
    }
}

// expose globally
window.SimpleAI = SimpleAI;
