// ai.js - Simple Negamax AI with extra diagnostics (FIXED)
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

        console.log('[AI] startAs → thinking');
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
        console.log('[AI] rootClone.board:');
        for (let r = 0; r < 8; r++) {
            console.log('  ' + rootClone.board[r].map(x => x || '.').join(' '));
        }

        setTimeout(() => {
            const best = this._findBestMove(rootClone, this.maxDepth);

            console.log('[AI] best move result:', best);

            if (!best.move || this._shouldStop) {
                console.warn('[AI] No legal move → stopping AI');
                this.stop();              // ⬅️ קריטי
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
            if (typeof clockInstance?.switchTurn === 'function') {
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

        moves.sort((a, b) => (b.capturedValue || 0) - (a.capturedValue || 0));

        for (const m of moves) {
            if (this._shouldStop) break;

            const makeResult = engineNode.makeMove(m.from.r, m.from.c, m.to.r, m.to.c, m.promotion || null);
            // engine.makeMove חוזר `false` רק על כשל אמיתי; אם חוזר null (לא game-over), זה עדיין הצלחה.
            if (makeResult === false) {
                continue;
            }


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

        if (depth === 0 || moves.length === 0) {
            const evalScore = node.evaluate();
            return colorSign * evalScore;
        }

        let maxScore = -Infinity;

        moves.sort((a, b) => (b.capturedValue || 0) - (a.capturedValue || 0));

        for (const m of moves) {
            // Apply the move and treat only explicit `false` as failure.
            const makeResult = node.makeMove(m.from.r, m.from.c, m.to.r, m.to.c, m.promotion || null);
            if (makeResult === false) continue;

            const score = -this._negamax(
                node,
                depth - 1,
                -beta,
                -alpha,
                -colorSign
            );

            // undo only if we actually applied a move
            node.undoMove();

            if (score > maxScore) maxScore = score;
            if (score > alpha) alpha = score;
            if (alpha >= beta) break;
        }

        return maxScore;
    }

    _generateAllLegalMoves(engineNode) {
        const moves = [];
        let totalPieces = 0;
        let ownPieces = 0;


        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = engineNode.getPiece(r, c);
                if (!p) continue;

                totalPieces++;

                if (!engineNode.isOwnPiece(r, c)) continue;
                ownPieces++;

                const legal = engineNode.getLegalMoves(r, c) || [];
                for (const m of legal) {
                    let capVal = 0;
                    const captured = engineNode.getPiece(m.r, m.c);
                    if (captured) {
                        capVal = PIECE_VALUES[(captured + '').toLowerCase()] || 0;
                    }
                    if (m.isEnPassant) capVal = PIECE_VALUES['p'];

                    const promotion = m.promotion
                        ? (isUpper(p) ? 'Q' : 'q')
                        : null;

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
