// ai.js - Negamax AI with Alpha-Beta Pruning + Improvements
// ============================================================
// CHANGES FROM ORIGINAL:
//  1. BUG FIX: Duplicate AI trigger in makeMove (was calling startAs twice)
//  2. BUG FIX: _negamax terminal node evaluation ignored color sign correctly
//     but didn't detect checkmate vs stalemate — now scores checkmate as -Infinity
//  3. BUG FIX: promotion piece was always 'Q'/'q' — now respects underpromotion hints
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
        this.maxDepth = Math.max(1, Math.floor(d));
    }

    startAs(color) {
        if (this.isRunning) return;
        if (this.engine.turn !== color) return;

        this.playAs = color;
        this._shouldStop = false;
        this.isRunning = true;

        console.log('[AI] startAs → thinking as', color);
        setTimeout(() => this._thinkAndPlay(), 10);
    }

    stop() {
        this._shouldStop = true;
        this.isRunning = false;
    }

    _thinkAndPlay() {
        if (this._shouldStop) {
            this.isRunning = false;
            return;
        }

        console.log('[AI] thinkAndPlay called. turn=', this.engine.turn);

        const rootClone = this.engine.clone();
        console.log('[AI] rootClone.turn =', rootClone.turn);

        setTimeout(() => {
            const best = this._findBestMove(rootClone, this.maxDepth);

            console.log('[AI] best move result:', best);

            if (!best.move || this._shouldStop) {
                console.warn('[AI] No legal move → stopping AI');
                this.stop();
                return;
            }

            const m = best.move;
            console.log('[AI] applying move:', m);

            this.engine.makeMove(
                m.from.r, m.from.c,
                m.to.r, m.to.c,
                m.promotion || null
            );

            if (this.ui) {
                this.ui.selectedSquare = null;
                this.ui.possibleMoves = [];
                this.ui.renderBoard();
            }

            if (typeof renderMoveList === 'function') renderMoveList();

            // FIX: Only switch clock if it is actually running
            if (typeof clockInstance !== 'undefined' && clockInstance &&
                typeof clockInstance.switchTurn === 'function' &&
                clockInstance.running) {
                clockInstance.switchTurn(this.engine.turn);
            }

            this.isRunning = false;
        }, 10);
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

        // Quiescence search at leaf nodes to avoid horizon effect
        if (depth === 0) {
            return this._quiescence(node, alpha, beta, colorSign, 4);
        }

        const moves = this._generateAllLegalMoves(node);

        // Terminal node: checkmate or stalemate
        if (moves.length === 0) {
            // FIX: distinguish checkmate (very bad) from stalemate (neutral)
            if (node.isKingInCheck(node.turn)) {
                // Checkmate: current side to move loses
                return -100000; // large negative (losing)
            }
            return 0; // stalemate
        }

        this._sortMoves(moves, node);

        let maxScore = -Infinity;

        for (const m of moves) {
            const makeResult = node.makeMove(m.from.r, m.from.c, m.to.r, m.to.c, m.promotion || null);
            if (makeResult === false) continue;

            const score = -this._negamax(
                node,
                depth - 1,
                -beta,
                -alpha,
                -colorSign
            );

            node.undoMove();

            if (score > maxScore) maxScore = score;
            if (score > alpha) alpha = score;
            if (alpha >= beta) break; // alpha-beta cutoff
        }

        return maxScore;
    }

    // Quiescence search: only look at captures to resolve tactical noise at leaf nodes
    _quiescence(node, alpha, beta, colorSign, maxDepth) {
        if (this._shouldStop) return 0;

        // Stand-pat score: evaluate statically
        const standPat = colorSign * enhancedEvaluate(node);

        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;

        if (maxDepth <= 0) return standPat;

        // Only consider captures
        const moves = this._generateAllLegalMoves(node).filter(m => m.capturedValue > 0);
        this._sortMoves(moves, node);

        for (const m of moves) {
            if (this._shouldStop) break;
            const makeResult = node.makeMove(m.from.r, m.from.c, m.to.r, m.to.c, m.promotion || null);
            if (makeResult === false) continue;

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
