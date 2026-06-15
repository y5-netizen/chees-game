const PIECE_IMAGES = {
    'P': 'main/wp.png', 'R': 'main/wr.png', 'N': 'main/wn.png', 'B': 'main/wb.png', 'Q': 'main/wq.png', 'K': 'main/wk.png',
    'p': 'main/bp.png', 'r': 'main/br.png', 'n': 'main/bn.png', 'b': 'main/bb.png', 'q': 'main/bq.png', 'k': 'main/bk.png'
};

const PIECE_VALUES = {
    'p': 10, 'n': 30, 'b': 30, 'r': 50, 'q': 90, 'k': 900,
    'P': 10, 'N': 30, 'B': 30, 'R': 50, 'Q': 90, 'K': 900
};

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function isUpper(p) { return p && p === p.toUpperCase(); }
function colorOf(p) { if (!p) return null; return isUpper(p) ? 'white' : 'black'; }

class ChessEngine {
    constructor() { this.reset(); }

    reset() {
        this.board = [
            ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
            ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null],
            ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
            ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
        ];
        this.turn = 'white';
        this.isGameOver = false;
        this.enPassantTarget = null; // {r, c} if exists
        this.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
        this.lastMove = null;
        this.moveHistory = [];
        this.redoStack = [];
        // inside reset(), near this.moveHistory = []; this.redoStack = [];
        this.masterHistory = []; // canonical list of applied moves (keeps in-sync with moveHistory)
        // --- בדיקות תקנים וקיום חוקים נוספים ---
        this.halfmoveClock = 0;              // מונה חצאי-מהלכים לחוק 50 מהלכים
        this.positionCount = new Map();     // מיפוי FEN חלקי -> ספירה, ל-threefold
        const startKey = this.getPositionKey ? this.getPositionKey() : null;
        if (startKey) this.positionCount.set(startKey, 1);
    }
    // מחזיר מחרוזת מייצגת מצב (FEN חלקי): board turn castling enPassant
    getPositionKey() {
        let board = '';

        for (let r = 0; r < 8; r++) {
            let empty = 0;
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (!p) empty++;
                else {
                    if (empty) {
                        board += empty;
                        empty = 0;
                    }
                    board += p;
                }
            }
            if (empty) board += empty;
            if (r < 7) board += '/';
        }

        const turn = this.turn || '-';
        // castlingRights needs to be serialized consistently, e.g. "KQkq" or "-"
        let castling = '-';
        if (this.castlingRights) {
            const parts = [];
            if (this.castlingRights.wK) parts.push('K');
            if (this.castlingRights.wQ) parts.push('Q');
            if (this.castlingRights.bK) parts.push('k');
            if (this.castlingRights.bQ) parts.push('q');
            castling = parts.length ? parts.join('') : '-';
        }

        const ep = this.enPassantTarget ? `${this.enPassantTarget.r}${this.enPassantTarget.c}` : '-';

        return `${board} ${turn} ${castling} ${ep}`;
    }
    // האם יש חומר לא מספיק לשחק (תיקו)
    hasInsufficientMaterial() {
        const pieces = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p) pieces.push(p.toLowerCase());
            }
        }

        // רק מלכים
        if (pieces.length === 2) return true;

        // K + (B|N) vs K
        if (pieces.length === 3) {
            // אם אחד הכלים הוא בישוף או פרש -> insufficient
            return pieces.includes('b') || pieces.includes('n');
        }

        // K+B vs K+B ויש לשני הבישופים אותו צבע משבצת
        if (pieces.length === 4 && pieces.filter(p => p === 'b').length === 2) {
            const bishopColors = [];
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const p = this.board[r][c];
                    if (p && p.toLowerCase() === 'b') bishopColors.push((r + c) % 2);
                }
            }
            if (bishopColors.length === 2 && bishopColors[0] === bishopColors[1]) return true;
        }

        return false;
    }


    getPiece(r, c) { return inBounds(r, c) ? this.board[r][c] : null; }
    isOwnPiece(r, c) {
        const p = this.getPiece(r, c);
        if (!p) return false;
        return this.turn === 'white' ? isUpper(p) : !isUpper(p);
    }

    getLegalMoves(r, c) {
        const piece = this.board[r][c];
        if (!piece) return [];
        let moves = this.getPseudoMoves(r, c);
        if (piece.toLowerCase() === 'k') moves = moves.concat(this.getCastleMoves(r, c, piece));
        return moves.filter(move => !this.testMoveLeavesKingInCheck(r, c, move.r, move.c, move));
    }

    getPseudoMoves(r, c) {
        const p = this.board[r][c];
        if (!p) return [];
        const type = p.toLowerCase();
        if (type === 'p') return this.getPawnMoves(r, c, p);
        if (type === 'r') return this.getSlidingMoves(r, c, [[0, 1], [0, -1], [1, 0], [-1, 0]]);
        if (type === 'b') return this.getSlidingMoves(r, c, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
        if (type === 'q') return this.getSlidingMoves(r, c, [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
        if (type === 'n') return this.getSteppingMoves(r, c, [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]]);
        if (type === 'k') return this.getSteppingMoves(r, c, [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
        return [];
    }

    getPawnMoves(r, c, p) {
        let moves = [];
        const dir = (p === 'P') ? -1 : 1;
        const startRow = (p === 'P') ? 6 : 1;

        // forward one
        if (inBounds(r + dir, c) && !this.getPiece(r + dir, c)) {
            const isProm = (p === 'P' && r + dir === 0) || (p === 'p' && r + dir === 7);
            moves.push({ r: r + dir, c: c, promotion: isProm });
            if (r === startRow && !this.getPiece(r + dir * 2, c)) moves.push({ r: r + dir * 2, c: c, isDouble: true });
        }

        // captures + en-passant
        [1, -1].forEach(side => {
            const nr = r + dir, nc = c + side;
            if (!inBounds(nr, nc)) return;
            const target = this.getPiece(nr, nc);
            const isProm = (p === 'P' && nr === 0) || (p === 'p' && nr === 7);

            if (target && !this.isSameColor(p, target)) {
                moves.push({ r: nr, c: nc, promotion: isProm });
            }
            if (this.enPassantTarget && this.enPassantTarget.r === nr && this.enPassantTarget.c === nc) {
                // en-passant can never be a promotion (since captured pawn is not on last rank),
                // but keep flag explicit false
                moves.push({ r: nr, c: nc, isEnPassant: true, promotion: false });
            }
        });

        return moves;
    }

    getSlidingMoves(r, c, dirs) {
        let moves = [];
        for (let d of dirs) {
            for (let i = 1; i < 8; i++) {
                const nr = r + d[0] * i, nc = c + d[1] * i;
                if (!inBounds(nr, nc)) break;
                const target = this.board[nr][nc];
                if (!target) moves.push({ r: nr, c: nc });
                else { if (!this.isSameColor(this.board[r][c], target)) moves.push({ r: nr, c: nc }); break; }
            }
        }
        return moves;
    }

    getSteppingMoves(r, c, offsets) {
        let moves = [];
        for (let o of offsets) {
            const nr = r + o[0], nc = c + o[1];
            if (!inBounds(nr, nc)) continue;
            if (!this.board[nr][nc] || !this.isSameColor(this.board[r][c], this.board[nr][nc])) moves.push({ r: nr, c: nc });
        }
        return moves;
    }

    getCastleMoves(r, c, p) {
        let moves = [];
        const color = isUpper(p) ? 'white' : 'black';
        if (this.isKingInCheck(color)) return moves;
        const row = r;
        const rights = color === 'white' ? { k: 'wK', q: 'wQ' } : { k: 'bK', q: 'bQ' };
        const kingCol = c;

        if (this.castlingRights[rights.k]) {
            const rook = this.getPiece(row, 7);
            if (rook && (color === 'white' ? rook === 'R' : rook === 'r')) {
                let clear = true;
                for (let cc = kingCol + 1; cc <= 6; cc++) if (this.getPiece(row, cc)) { clear = false; break; }
                if (clear) {
                    if (!this.testMoveLeavesKingInCheck(row, kingCol, row, kingCol + 1) &&
                        !this.testMoveLeavesKingInCheck(row, kingCol, row, kingCol + 2)) {
                        moves.push({ r: row, c: kingCol + 2, isCastle: 'k' });
                    }
                }
            }
        }

        if (this.castlingRights[rights.q]) {
            const rook = this.getPiece(row, 0);
            if (rook && (color === 'white' ? rook === 'R' : rook === 'r')) {
                let clear = true;
                for (let cc = kingCol - 1; cc >= 1; cc--) if (this.getPiece(row, cc)) { clear = false; break; }
                if (clear) {
                    if (!this.testMoveLeavesKingInCheck(row, kingCol, row, kingCol - 1) &&
                        !this.testMoveLeavesKingInCheck(row, kingCol, row, kingCol - 2)) {
                        moves.push({ r: row, c: kingCol - 2, isCastle: 'q' });
                    }
                }
            }
        }

        return moves;
    }

    isKingInCheck(color) {
        let kingPos = null;
        const kingChar = color === 'white' ? 'K' : 'k';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.board[r][c] === kingChar) { kingPos = { r, c }; break; }
            }
            if (kingPos) break;
        }
        if (!kingPos) return true;
        const enemyColor = color === 'white' ? 'black' : 'white';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (!p) continue;
                if ((enemyColor === 'white' && isUpper(p)) || (enemyColor === 'black' && !isUpper(p))) {
                    const moves = this.getPseudoMoves(r, c);
                    if (moves.some(m => m.r === kingPos.r && m.c === kingPos.c)) return true;
                }
            }
        }
        return false;
    }

    testMoveLeavesKingInCheck(fromR, fromC, toR, toC, moveObject = null) {
        const piece = this.board[fromR][fromC];
        if (!piece) return true;

        const captured = this.board[toR][toC];
        let capturedEnPassant = null;
        if (!captured && piece.toLowerCase() === 'p' && fromC !== toC) {
            capturedEnPassant = this.board[fromR][toC];
            this.board[fromR][toC] = null;
        }

        this.board[toR][toC] = piece;
        this.board[fromR][fromC] = null;

        const movingColor = isUpper(piece) ? 'white' : 'black';
        const inCheck = this.isKingInCheck(movingColor);

        this.board[fromR][fromC] = piece;
        this.board[toR][toC] = captured;
        if (capturedEnPassant !== null) this.board[fromR][toC] = capturedEnPassant;

        return inCheck;
    }

    /* REPLACE makeMove */
    makeMove(fromR, fromC, toR, toC, promotionPiece = null) {
        const piece = this.board[fromR][fromC];
        if (!piece) return false;

        const moves = this.getLegalMoves(fromR, fromC);
        const moveData = moves.find(m => m.r === toR && m.c === toC);
        if (!moveData) return false;

        if (moveData.promotion && !promotionPiece) return false;

        // ========== PREPARE SNAPSHOT ==========
        const prevTurn = this.turn;
        const prevEnPassant = this.enPassantTarget ? { r: this.enPassantTarget.r, c: this.enPassantTarget.c } : null;
        const prevCastling = { ...this.castlingRights };
        const prevHalf = this.halfmoveClock;
        const prevPosCount = new Map(this.positionCount);
        const prevIsGameOver = this.isGameOver;
        const prevLastMove = this.lastMove ? { ...this.lastMove } : null;

        // captured piece
        let capturedPiece = null;
        let capturedPos = null;
        if (moveData.isEnPassant) {
            capturedPiece = this.board[fromR][toC];
            capturedPos = { r: fromR, c: toC };
        } else {
            capturedPiece = this.board[toR][toC];
            capturedPos = { r: toR, c: toC };
        }

        const historyEntry = {
            from: { r: fromR, c: fromC, piece },
            to: { r: toR, c: toC, captured: capturedPiece, capturedPos },
            special: { ...moveData },
            prevTurn,
            postTurn: null,
            prevEnPassant,
            prevCastling,
            prevHalfmoveClock: prevHalf,
            prevPositionCount: prevPosCount,
            prevIsGameOver,
            prevLastMove
        };

        // ========== PERFORM MOVE ==========
        if (moveData.isEnPassant) this.board[fromR][toC] = null;

        this.board[toR][toC] = piece;
        this.board[fromR][fromC] = null;

        if (moveData.isCastle === 'k') {
            this.board[toR][toC - 1] = this.board[toR][7];
            this.board[toR][7] = null;
        }
        if (moveData.isCastle === 'q') {
            this.board[toR][toC + 1] = this.board[toR][0];
            this.board[toR][0] = null;
        }

        if (piece.toLowerCase() === 'p' && (toR === 0 || toR === 7)) {
            this.board[toR][toC] = promotionPiece || (isUpper(piece) ? 'Q' : 'q');
            historyEntry.promotionPiece = this.board[toR][toC];
        }

        // castling rights
        if (piece === 'K') { this.castlingRights.wK = false; this.castlingRights.wQ = false; }
        if (piece === 'k') { this.castlingRights.bK = false; this.castlingRights.bQ = false; }

        if (piece === 'R') {
            if (fromR === 7 && fromC === 7) this.castlingRights.wK = false;
            if (fromR === 7 && fromC === 0) this.castlingRights.wQ = false;
        }
        if (piece === 'r') {
            if (fromR === 0 && fromC === 7) this.castlingRights.bK = false;
            if (fromR === 0 && fromC === 0) this.castlingRights.bQ = false;
        }

        if (capturedPiece === 'R') {
            if (capturedPos.r === 7 && capturedPos.c === 7) this.castlingRights.wK = false;
            if (capturedPos.r === 7 && capturedPos.c === 0) this.castlingRights.wQ = false;
        }
        if (capturedPiece === 'r') {
            if (capturedPos.r === 0 && capturedPos.c === 7) this.castlingRights.bK = false;
            if (capturedPos.r === 0 && capturedPos.c === 0) this.castlingRights.bQ = false;
        }

        const isPawnMove = piece && piece.toLowerCase() === 'p';
        const isCapture = !!capturedPiece;

        this.enPassantTarget = moveData.isDouble ? { r: Math.floor((fromR + toR) / 2), c: toC } : null;
        this.lastMove = { from: { r: fromR, c: fromC }, to: { r: toR, c: toC }, special: moveData };

        this.halfmoveClock = (isPawnMove || isCapture) ? 0 : (this.halfmoveClock || 0) + 1;

        // flip turn
        this.turn = this.turn === 'white' ? 'black' : 'white';
        // === הפעלת AI אחרי מעבר תור ===
        if (
            aiEnabled &&
            window.aiPlayer &&
            engine.turn === aiColor &&
            !window.aiPlayer.isRunning
        ) {
            console.log('AI turn detected → starting AI');
            window.aiPlayer.startAs(aiColor);
        }
        historyEntry.postTurn = this.turn;

        // ======= הפעלת AI אם מצב נגד מחשב פעיל =======

        // update position count
        if (this.getPositionKey) {
            const key = this.getPositionKey();
            const prev = this.positionCount.get(key) || 0;
            this.positionCount.set(key, prev + 1);
        }
        historyEntry.postPositionCount = new Map(this.positionCount);

        // push history
        this.moveHistory.push(historyEntry);
        this.redoStack = [];
        this.masterHistory.push({
            from: { r: fromR, c: fromC },
            to: { r: toR, c: toC },
            promotion: historyEntry.promotionPiece || null,
            piece: piece
        });

        const result = this.checkGameOver();
        if (result) this.isGameOver = true;

        return result;
    }
// --------------- undoMove / redoMove ---------------
    undoMove() {
        if (!this.moveHistory || this.moveHistory.length === 0) return false;
        const entry = this.moveHistory.pop();
        // keep masterHistory in sync with undo
        if (this.masterHistory && this.masterHistory.length) {
            this.masterHistory.pop();
        }


        // העבר ל-redo stack
        this.redoStack.push(entry);

        // restore moved piece back to from-square
        const piece = entry.from.piece;
        this.board[entry.from.r][entry.from.c] = piece;

        // clear destination by restoring captured (or null)
        // note: entry.to.captured is the captured piece before the move (or null)
        if (entry.special && entry.special.isEnPassant && entry.to.capturedPos) {
            // en-passant: the destination was empty; we need to restore captured pawn to its capturedPos
            const cap = entry.to.capturedPos;
            this.board[cap.r][cap.c] = entry.to.captured;
            // ensure destination is empty
            this.board[entry.to.r][entry.to.c] = null;
        } else {
            this.board[entry.to.r][entry.to.c] = entry.to.captured || null;
        }

        // if castle - move rook back
        if (entry.special && entry.special.isCastle === 'k') {
            const r = entry.to.r;
            const rookFrom = { r, c: entry.to.c - 1 };
            const rookTo = { r, c: 7 };
            this.board[rookTo.r][rookTo.c] = this.board[rookFrom.r][rookFrom.c];
            this.board[rookFrom.r][rookFrom.c] = null;
        }
        if (entry.special && entry.special.isCastle === 'q') {
            const r = entry.to.r;
            const rookFrom = { r, c: entry.to.c + 1 };
            const rookTo = { r, c: 0 };
            this.board[rookTo.r][rookTo.c] = this.board[rookFrom.r][rookFrom.c];
            this.board[rookFrom.r][rookFrom.c] = null;
        }

        // if there was a promotion, the piece on from-square should be pawn again;
        // entry.from.piece holds original piece, so we already restored it.

        // restore meta state
        this.enPassantTarget = entry.prevEnPassant ? { ...entry.prevEnPassant } : null;
        this.castlingRights = { ...entry.prevCastling };
        this.halfmoveClock = entry.prevHalfmoveClock;
        this.positionCount = new Map(entry.prevPositionCount);
        this.isGameOver = entry.prevIsGameOver;
        this.lastMove = entry.prevLastMove ? { ...entry.prevLastMove } : null;
        this.turn = entry.prevTurn;

        return true;
    }

    redoMove() {
        if (!this.redoStack || this.redoStack.length === 0) return false;
        const entry = this.redoStack.pop();

        // remove piece from from-square
        const fromR = entry.from.r, fromC = entry.from.c, toR = entry.to.r, toC = entry.to.c;
        const piece = entry.from.piece;

        this.board[fromR][fromC] = null;

        // handle en-passant capture removal
        if (entry.special && entry.special.isEnPassant && entry.to.capturedPos) {
            const cap = entry.to.capturedPos;
            this.board[cap.r][cap.c] = null;
        }

        // place piece on destination (promotion handled by stored promotionPiece)
        if (entry.promotionPiece) this.board[toR][toC] = entry.promotionPiece;
        else this.board[toR][toC] = piece;

        // handle castle rook move
        if (entry.special && entry.special.isCastle === 'k') {
            this.board[toR][toC - 1] = this.board[toR][7];
            this.board[toR][7] = null;
        }
        if (entry.special && entry.special.isCastle === 'q') {
            this.board[toR][toC + 1] = this.board[toR][0];
            this.board[toR][0] = null;
        }

        // restore post-state: positionCount, turn, castling if available.
        if (entry.postPositionCount) this.positionCount = new Map(entry.postPositionCount);
        this.turn = entry.postTurn || this.turn;

        // push back to history
        this.moveHistory.push(entry);
        // restore masterHistory entry on redo
        if (!this.masterHistory) this.masterHistory = [];
        this.masterHistory.push({
            from: { r: entry.from.r, c: entry.from.c },
            to: { r: entry.to.r, c: entry.to.c },
            promotion: entry.promotionPiece || null,
            piece: entry.from.piece
        });


        return true;
    }


    checkGameOver() {
        // 50-move rule
        if (this.halfmoveClock >= 100) {
            this.isGameOver = true;
            return { type: 'stalemate', reason: '50-move rule' };
        }

        // threefold repetition: בדוק את המפתח הנוכחי
        if (this.getPositionKey) {
            const key = this.getPositionKey();
            if ((this.positionCount.get(key) || 0) >= 3) {
                this.isGameOver = true;
                return { type: 'stalemate', reason: 'threefold repetition' };
            }
        }

        // insufficient material
        if (this.hasInsufficientMaterial && this.hasInsufficientMaterial()) {
            this.isGameOver = true;
            return { type: 'stalemate', reason: 'insufficient material' };
        }

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.isOwnPiece(r, c) && this.getLegalMoves(r, c).length > 0) {
                    return null;
                }
            }
        }
        return this.isKingInCheck(this.turn) ? 'checkmate' : 'stalemate';
    }

    isSameColor(p1, p2) { if (!p1 || !p2) return false; return (isUpper(p1) === isUpper(p2)); }

    evaluate() {
        let s = 0;
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            const p = this.board[r][c];
            if (p) s += (isUpper(p) ? PIECE_VALUES[p] : -PIECE_VALUES[p]);
        }
        return s;
    }
    // --- clone() for AI (deep copy of engine state) ---
    clone() {
        const copy = new ChessEngine();
        // shallow constructor called; now copy fields
        copy.board = this.board.map(row => row.slice());
        copy.turn = this.turn;
        copy.isGameOver = this.isGameOver;
        copy.enPassantTarget = this.enPassantTarget ? { r: this.enPassantTarget.r, c: this.enPassantTarget.c } : null;
        copy.castlingRights = { ...this.castlingRights };
        copy.lastMove = this.lastMove ? JSON.parse(JSON.stringify(this.lastMove)) : null;
        // clone history structures lightly (used for move-list etc.)
        copy.moveHistory = this.moveHistory ? JSON.parse(JSON.stringify(this.moveHistory)) : [];
        copy.redoStack = this.redoStack ? JSON.parse(JSON.stringify(this.redoStack)) : [];
        copy.halfmoveClock = this.halfmoveClock;
        copy.positionCount = new Map(this.positionCount); // copy map
        copy.masterHistory = this.masterHistory ? JSON.parse(JSON.stringify(this.masterHistory)) : [];
        // don't set UI specific things
        return copy;
    }

}

class GameClock {
    constructor(minutesPerSide, incrementSeconds = 0) {
        this.whiteTime = minutesPerSide * 60 * 1000;
        this.blackTime = minutesPerSide * 60 * 1000;
        this.increment = incrementSeconds * 1000;

        this.running = false;
        this.turn = 'white';
        this.lastTimestamp = null;
        this.onFlag = null; // callback
    }
    update() {
        this._tick();
    }


    start(turn) {
        this.turn = turn;
        this.running = true;
        this.lastTimestamp = performance.now();
    }

    stop() {
        if (!this.running) return;
        this._tick();
        this.running = false;
    }

    switchTurn(newTurn) {
        this._tick();
        if (this.turn === 'white') {
            this.whiteTime += this.increment;
        } else {
            this.blackTime += this.increment;
        }
        this.turn = newTurn;
        this.lastTimestamp = performance.now();
    }

    _tick() {
        if (!this.running) return;
        const now = performance.now();
        const delta = now - this.lastTimestamp;
        this.lastTimestamp = now;

        if (this.turn === 'white') {
            this.whiteTime -= delta;
            if (this.whiteTime <= 0) this._flag('white');
        } else {
            this.blackTime -= delta;
            if (this.blackTime <= 0) this._flag('black');
        }
    }

    _flag(color) {
        this.running = false;
        if (this.onFlag) this.onFlag(color);
    }

    getTimes() {
        return {
            white: Math.max(0, this.whiteTime),
            black: Math.max(0, this.blackTime)
        };
    }
}

class ChessUI {
    constructor(engine) {
        this.engine = engine;
        this.boardEl = document.getElementById('board');
        this.selectedSquare = null; // stored in engine coords {r,c}
        this.possibleMoves = [];    // engine coords
        this.isFlipped = false;
        this.renderBoard();
        this.draggedFrom = null;
        this.previewEngine = null; // null = live game
        this.previewMoveIndex = null;
        this.allowUndoWhilePreview = false;

    }
    // בתוך class ChessUI
    updateControlStates() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (!undoBtn || !redoBtn) return;

        if (this.previewEngine && !this.allowUndoWhilePreview) {
            undoBtn.disabled = true;
            redoBtn.disabled = true;
        } else {
            undoBtn.disabled = false;
            redoBtn.disabled = false;
        }
    }

    goToMove(moveIndex) {
        // צור engine חדש ונקי
        const preview = new ChessEngine();
        preview.reset();

        // שחק עד המהלך המבוקש
        for (let i = 0; i <= moveIndex; i++) {
            const m = this.engine.moveHistory[i];
            if (!m) break;
            preview.makeMove(
                m.from.r,
                m.from.c,
                m.to.r,
                m.to.c,
                m.promotionPiece || null
            );
        }

        this.previewEngine = preview;
        this.previewMoveIndex = moveIndex;
        this.selectedSquare = null;
        this.possibleMoves = [];
        this.renderBoard();
    }

    handleMove(from, to, promotion = null) {
        // קבל את המהלך החוקי (אם קיים) במקום בדיקה בוליאנית בלבד
        const legalMoves = this.engine.getLegalMoves(from.r, from.c);
        const legalMove = legalMoves.find(m => m.r === to.r && m.c === to.c);

        // אם המהלך לא חוקי — נקים מצב ונשרטט לוח ולא נעשה כלום אחר
        if (!legalMove) {
            this.selectedSquare = null;
            this.possibleMoves = [];
            this.renderBoard();
            return;
        }

        // אם זה מהלך קידום חוקי אבל אין עדיין בחירת קידום — בקש בחירה ואז חזור לפונקציה
        if (legalMove.promotion && !promotion) {
            // askPromotion מחזירה Promise (הקיימת בקוד שלך), לכן נטפל ב־then
            this.askPromotion(this.engine.turn).then(chosen => {
                // כאשר המשתמש בחר כלי — נבצע את המהלך עם הקידום
                this.handleMove(from, to, chosen);
            }).catch(() => {
                // במקרה והמשתמש ביטל את תפריט הקידום — רק נסדר UI מחדש
                this.selectedSquare = null;
                this.possibleMoves = [];
                this.renderBoard();
            });
            return; // חשוב — לא לבצע את המהלך עכשיו
        }

        // עכשיו המהלך חוקי (ואם צריך קידום — הוא כבר נבחר ועמד בפרמטר promotion)
        const result = this.engine.makeMove(from.r, from.c, to.r, to.c, promotion);

        // עדכון השעון (אם קיים)
        if (typeof clockInstance !== 'undefined' && clockInstance) {
            clockInstance.switchTurn(this.engine.turn);
        }

        // ננקה בחירה ונרנדר לוח
        this.selectedSquare = null;
        this.possibleMoves = [];
        this.renderBoard();

        // עדכון רשימת המהלכים — רק אחרי שהמהלך בוצע והיסטוריית המהלכים עודכנה
        if (typeof renderMoveList === 'function') renderMoveList();

        // בדיקת סיום משחק
        if (result) {
            if (typeof clockInstance !== 'undefined' && clockInstance && typeof clockInstance.stop === 'function') {
                clockInstance.stop();
            }
            this.showGameOver(result);
        }
    }

    /* -- המרות UI <-> Engine -- */
    uiToEngineCoords(uiR, uiC) {
        if (!this.isFlipped) return { r: uiR, c: uiC };
        return { r: 7 - uiR, c: 7 - uiC };
    }
    engineToUiCoords(r, c) {
        if (!this.isFlipped) return { r, c };
        return { r: 7 - r, c: 7 - c };
    }

    /* -- renderBoard משתמש ב-UI קואורדינטות (uiR,uiC) ואז ממפה ל-engine -- */
    renderBoard() {
        // use previewEngine for display if exists, otherwise real engine
        const engineToUse = this.previewEngine || this.engine;

        this.boardEl.innerHTML = '';
        // Force the board grid to render left-to-right so UI loops match engine coordinates
        this.boardEl.style.direction = 'ltr';

        // evaluation / status from engineToUse (preview or live)
        const evalEl = document.getElementById('eval-score');
        if (evalEl) evalEl.innerText = engineToUse.evaluate();

        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.innerText = `תור: ${engineToUse.turn === 'white' ? "לבן" : "שחור"}`;

        for (let uiR = 0; uiR < 8; uiR++) {
            for (let uiC = 0; uiC < 8; uiC++) {
                const { r, c } = this.uiToEngineCoords(uiR, uiC);

                const sq = document.createElement('div');
                sq.addEventListener('dragover', (e) => {
                    e.preventDefault(); // חובה
                });

                // drop handler MUST use the real engine (we'll keep the same behavior as before).
                // If preview is active, ignore drops (don't allow changing live game via preview).
                sq.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    if (!canPlayerMove()) return; // ❌ חסום אם זה תור AI
                    if (this.previewEngine) return;

                    let from = this.draggedFrom;

                    if (!from) {
                        try {
                            const data = e.dataTransfer.getData('text/plain');
                            if (data) {
                                const parts = data.split(',');
                                const fr = parseInt(parts[0], 10);
                                const fc = parseInt(parts[1], 10);
                                if (!Number.isNaN(fr) && !Number.isNaN(fc)) {
                                    from = { r: fr, c: fc };
                                }
                            }
                        } catch (err) {
                            console.warn('drop: could not read dataTransfer', err);
                        }
                    }

                    if (!from) return;

                    const to = { r, c };
                    this.draggedFrom = null;

                    const legalMoves = this.engine.getLegalMoves(from.r, from.c);
                    const moveData = legalMoves.find(m => m.r === to.r && m.c === to.c);
                    if (!moveData) return;

                    const movingPiece = this.engine.getPiece(from.r, from.c);
                    const isPawn = movingPiece && movingPiece.toLowerCase() === 'p';
                    if (moveData.promotion && isPawn) {
                        const color = isUpper(movingPiece) ? 'white' : 'black';
                        const promo = await this.askPromotion(color);
                        this.handleMove(from, to, promo);
                    } else {
                        this.handleMove(from, to);
                    }
                });
                // compute square color using engine coords (fix parity issues)
                const isLight = ((r + c) % 2 === 1); // choose parity you prefer (1 => a1 dark)
                sq.className = `square ${isLight ? 'light' : 'dark'}`;

                // סימון מהלך אחרון (מ־engineToUse — כלומר גם preview יציג מהלך אחרון נכון)
                if (engineToUse.lastMove &&
                    ((engineToUse.lastMove.from.r === r && engineToUse.lastMove.from.c === c) ||
                        (engineToUse.lastMove.to.r === r && engineToUse.lastMove.to.c === c))) {
                    sq.style.backgroundColor = "rgba(255, 255, 0, 0.4)";
                } else {
                    // ensure we don't keep inline style between renders
                    sq.style.backgroundColor = '';
                }

                // selectedSquare compare against engineToUse (so selection highlights preview appropriately)
                if (this.selectedSquare && this.selectedSquare.r === r && this.selectedSquare.c === c) sq.classList.add('selected');

                // סימון מהלכים אפשריים - only when not in preview (possibleMoves belong to live engine)
                const moveHint = (!this.previewEngine) ? this.possibleMoves.find(m => m.r === r && m.c === c) : null;
                if (moveHint) {
                    if (this.engine.getPiece(r, c)) sq.classList.add('hint-capture');
                    else sq.classList.add('hint-move');
                }

                // use engineToUse to read pieces for display
                const p = engineToUse.getPiece(r, c);
                if (p) {
                    const img = document.createElement('img');
                    // draggable only when not in preview AND the piece belongs to the player to move on the live engine
                    img.draggable = !this.previewEngine;

                    if (!this.previewEngine) {
                        img.addEventListener('dragstart', (e) => {
                            if (!canPlayerMove()) { // ❌ חסום אם זה תור AI
                                e.preventDefault();
                                return;
                            }

                            if (!this.engine.isOwnPiece(r, c)) {
                                e.preventDefault();
                                return;
                            }

                            try {
                                e.dataTransfer.setData('text/plain', `${r},${c}`);
                                e.dataTransfer.effectAllowed = 'move';
                            } catch (err) {
                                console.warn('dataTransfer.setData failed', err);
                            }

                            this.draggedFrom = { r, c };
                            this.selectedSquare = { r, c };
                            this.possibleMoves = this.engine.getLegalMoves(r, c);

                            if (sq && !sq.classList.contains('selected-drag')) {
                                sq.classList.add('selected-drag');
                            }
                        });
                        // dragend cleanup
                        img.addEventListener('dragend', (e) => {
                            this.draggedFrom = null;
                            this.selectedSquare = null;
                            this.possibleMoves = [];
                            this.renderBoard();
                        });
                    } else {
                        // if in preview, optionally add a "disabled" style class
                        img.classList.add('not-draggable');
                    }

                    img.src = PIECE_IMAGES[p];
                    img.className = 'piece-img';
                    sq.appendChild(img);
                }

                // only allow clicks to change live selection when NOT in preview
                sq.onclick = () => {
                    if (!this.previewEngine && canPlayerMove()) {
                        this.handleSquareClick(uiR, uiC);
                    }
                };
                this.boardEl.appendChild(sq);
            }
        }
        this.updateControlStates();
    }
    // בתוך מחלקת ChessUI
    updateControlStates() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        const liveBtn = document.getElementById('moves-live-btn'); // הכפתור Live אם קיים

        // מצב האם אנחנו בפריוויו
        const inPreview = !!this.previewEngine;
        // האם המשתמש אפשר ביטול בזמן פריוויו (דגל שנמצא בקונסטרקטור)
        const allowWhilePreview = !!this.allowUndoWhilePreview;

        // אם אנחנו בפריוויו ולדגל אין היתר - השבת כפתורים
        if (undoBtn) {
            undoBtn.disabled = inPreview && !allowWhilePreview;
            if (undoBtn.disabled) undoBtn.classList.add('btn-disabled'); else undoBtn.classList.remove('btn-disabled');
        }
        if (redoBtn) {
            redoBtn.disabled = inPreview && !allowWhilePreview;
            if (redoBtn.disabled) redoBtn.classList.add('btn-disabled'); else redoBtn.classList.remove('btn-disabled');
        }

        // Live button: מוצג רק בזמן פריוויו (אופציונלי)
        if (liveBtn) {
            liveBtn.style.display = inPreview ? 'inline-block' : 'none';
        }
    }

    /* handleSquareClick מקבל UI קואורדינטות, ממפה ל-engine ומשתמש ב-engine בלבד מעכשיו */
    async handleSquareClick(uiR, uiC) {
        if (this.engine.isGameOver) return;

        const { r, c } = this.uiToEngineCoords(uiR, uiC);

        // ניסיון להזיז אם יש בחירה
        if (this.selectedSquare) {
            const move = this.possibleMoves.find(m => m.r === r && m.c === c);
            if (move) {
                let promo = null;
                const piece = this.engine.board[this.selectedSquare.r][this.selectedSquare.c];
                if (piece.toLowerCase() === 'p' && (r === 0 || r === 7)) {
                    promo = await this.askPromotion(this.engine.turn);
                }
                this.handleMove(this.selectedSquare, { r, c }, promo);
                return;
            }
        }

        // בחירת כלי
        if (this.engine.isOwnPiece(r, c)) {
            this.selectedSquare = { r, c };
            this.possibleMoves = this.engine.getLegalMoves(r, c);
        } else {
            this.selectedSquare = null;
            this.possibleMoves = [];
        }

        this.renderBoard();
    }


    askPromotion(color) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'promotion-overlay';
            const menu = document.createElement('div');
            menu.className = 'promotion-menu';
            const options = color === 'white' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];

            options.forEach(type => {
                const img = document.createElement('img');
                img.src = PIECE_IMAGES[type];
                img.className = 'promotion-option';
                img.onclick = () => {
                    document.body.removeChild(overlay);
                    resolve(type);
                };
                menu.appendChild(img);
            });
            overlay.appendChild(menu);
            document.body.appendChild(overlay);
        });
    }

    showGameOver(type) {
        const modal = document.getElementById('game-over-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        if (type === 'checkmate') {
            const winner = this.engine.turn === 'white' ? 'השחור' : 'הלבן';
            document.getElementById('winner-title').innerText = `מט! ${winner} ניצח!`;
            document.getElementById('end-reason').innerText = `בדיקה מסיימת: ${winner} ניצח על ידי מט.`;
        } else {
            document.getElementById('winner-title').innerText = `תיקו`;
            document.getElementById('end-reason').innerText = `התוצאה: תיקו (חוסר מהלכים חוקיים).`;
        }
    }
    // inside class ChessUI

    enterPreview(moveCount) {
        // create a temporary engine and apply first moveCount moves from engine.masterHistory
        const temp = new ChessEngine(); // starts at initial position
        const hist = (this.engine.masterHistory && this.engine.masterHistory.length) ? this.engine.masterHistory : (this.engine.moveHistory || []);
        for (let i = 0; i < Math.min(moveCount, hist.length); i++) {
            const m = hist[i];
            // m.promotion might be like 'Q' or 'q' or null
            temp.makeMove(m.from.r, m.from.c, m.to.r, m.to.c, m.promotion || null);
        }
        this.previewEngine = temp;
        this.previewCount = moveCount;
        this.renderBoard();
        this.updateControlStates();
    }

    exitPreview() {
        this.previewEngine = null;
        this.previewCount = null;
        this.renderBoard();
        this.updateControlStates();
    }

}

/* --- init --- */
const engine = new ChessEngine();
const ui = new ChessUI(engine);

// ===== AI =====
let aiEnabled = false;
let aiColor = 'black';

window.aiPlayer = new SimpleAI(engine, ui);
window.aiPlayer.setDepth(6);

function canPlayerMove() {
    if (!aiEnabled) return true;
    if (engine.turn === aiColor) return false;
    return true;
}

console.log('AI created:', window.aiPlayer);



const originalMakeMove = engine.makeMove.bind(engine);
engine.makeMove = function (fromR, fromC, toR, toC, promotionPiece = null) {
    const result = originalMakeMove(fromR, fromC, toR, toC, promotionPiece);

    if (aiEnabled && engine.turn === aiColor) {
        // במקום _thinkAndPlay:
        aiPlayer.startAs(aiColor);
    }

    return result;
};



// --- expose simple global game API used by inline HTML onclicks (and safe alternative listeners) ---
window.game = {
    undo: () => {
        // אם אנחנו בצפייה בפריוויו ובדגל לא מאפשר שינוי — חסום את הפעולה
        if (ui && ui.previewEngine && !ui.allowUndoWhilePreview) {
            alert('לא ניתן לבצע ביטול בזמן צפייה בעבר. לחץ Live כדי לחזור למצב החי או אפשר Undo בזמן פריוויו בהגדרות.');
            return;
        }

        // in case preview was allowed, we continue and apply undo to live engine
        const ok = engine.undoMove();
        if (ok) {
            ui.selectedSquare = null;
            ui.possibleMoves = [];
            // אם היינו בפריוויו ורוצים להתעדכן — נבטל את הפריוויו (אופציונלי)
            if (ui && ui.previewEngine) {
                // אם אפשרנו undoWhilePreview — נשמור preview אך עדיף לצאת כדי לא לבלבל
                ui.exitPreview();
            }
            ui.renderBoard();
            if (typeof renderMoveList === 'function') renderMoveList(); maybeAiMove();
        } else {
            alert('אין מהלכים לבטל');
        }
    },

    redo: () => {
        if (ui && ui.previewEngine && !ui.allowUndoWhilePreview) {
            alert('לא ניתן לבצע החזרה בזמן צפייה בעבר. לחץ Live כדי לחזור למצב החי או אפשר Redo בזמן פריוויו בהגדרות.');
            return;
        }

        const ok = engine.redoMove();
        if (ok) {
            ui.selectedSquare = null;
            ui.possibleMoves = [];
            if (ui && ui.previewEngine) {
                ui.exitPreview();
            }
            ui.renderBoard();
            if (typeof renderMoveList === 'function') renderMoveList(); maybeAiMove();
        } else {
            alert('אין מהלכים לבצע שוב');
        }
    },

    reset: () => {
        if (!confirm("להתחיל מחדש?")) return;

        // אם בצפיית פריוויו — צא קודם
        if (ui && ui.previewEngine) {
            ui.exitPreview();
        }

        engine.reset();
        ui.selectedSquare = null;
        ui.possibleMoves = [];
        ui.renderBoard();
        if (typeof renderMoveList === 'function') renderMoveList();

        const modal = document.getElementById('game-over-modal');
        if (modal) modal.style.display = 'none';
    },

    flipBoard: () => {
        ui.isFlipped = !ui.isFlipped;
        ui.selectedSquare = null;
        ui.possibleMoves = [];
        ui.renderBoard();
    },

    toggleAI: () => {
        // הפוך מצב הדגל
        aiEnabled = !aiEnabled;

        // קבל את האלמנטים (ייתכן שהם לא קיימים — לכן בדיקה אחרי הקריאה)
        const statusSpan = document.getElementById('ai-status');
        const aiControls = document.getElementById('ai-controls');
        const depthInput = document.getElementById('aiDepthInput');

        if (aiEnabled) {
            // עדכן סטטוס אם האלמנט קיים
            if (statusSpan) statusSpan.innerText = 'פועל';
            // הצג את בקרת העומק אם קיימת
            if (aiControls) aiControls.style.display = 'block';

            // העמס עומק התחלתי ל-AI אם הוא קיים והשדה קיים
            if (window.aiPlayer && depthInput) {
                aiPlayer.setDepth(parseInt(depthInput.value, 10) || 3);
            }
        } else {
            if (statusSpan) statusSpan.innerText = 'כבוי';
            if (aiControls) aiControls.style.display = 'none';
        }
    },

    goLive: () => {
        if (ui) {
            ui.exitPreview();
            ui.selectedSquare = null;
            ui.possibleMoves = [];
            ui.renderBoard();
        }
    }
};


// =================== Clock on-demand / UI controls ===================

// global ref to current clock (or null)
let clockInstance = null;
let clockStartTimerId = null;
let clocksRenderIntervalId = null;

// build clock markup
function renderClocksUI() {
    const container = document.getElementById('clocks');
    container.innerHTML = '';
    if (!clockInstance) {
        container.classList.add('no-clock');
        return;
    }
    container.classList.remove('no-clock');

    // White clock row
    const wRow = document.createElement('div');
    wRow.className = 'clock-row' + ((clockInstance.running && clockInstance.turn === 'white') ? ' active' : '');
    const wLabel = document.createElement('div'); wLabel.className = 'clock-label'; wLabel.innerText = 'לבן';
    const wTime = document.createElement('div'); wTime.className = 'clock-time'; wTime.id = 'whiteClock';
    wRow.appendChild(wLabel); wRow.appendChild(wTime);
    container.appendChild(wRow);

    // Black clock row
    const bRow = document.createElement('div');
    bRow.className = 'clock-row' + ((clockInstance.running && clockInstance.turn === 'black') ? ' active' : '');
    const bLabel = document.createElement('div'); bLabel.className = 'clock-label'; bLabel.innerText = 'שחור';
    const bTime = document.createElement('div'); bTime.className = 'clock-time'; bTime.id = 'blackClock';
    bRow.appendChild(bLabel); bRow.appendChild(bTime);
    container.appendChild(bRow);
}

// format helper (reuse if already present)
function formatTime(ms) {
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = Math.abs(total % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// render loop (updates clocks and active styles)
// starts/stops interval based on whether clockInstance exists
function ensureClocksRendering() {
    if (clocksRenderIntervalId) clearInterval(clocksRenderIntervalId);
    if (!clockInstance) {
        // clear existing DOM times if any
        const wc = document.getElementById('whiteClock'); if (wc) wc.innerText = '';
        const bc = document.getElementById('blackClock'); if (bc) bc.innerText = '';
        return;
    }
    // initial render of UI elements
    renderClocksUI();

    clocksRenderIntervalId = setInterval(() => {
        // make clock compute actual time
        if (clockInstance && typeof clockInstance.update === 'function') clockInstance.update();

        const times = clockInstance.getTimes();
        const w = document.getElementById('whiteClock');
        const b = document.getElementById('blackClock');
        if (w) w.innerText = formatTime(times.white);
        if (b) b.innerText = formatTime(times.black);

        // active highlight
        const rows = document.querySelectorAll('#clocks .clock-row');
        rows.forEach(row => row.classList.remove('active'));
        if (clockInstance && clockInstance.running) {
            if (clockInstance.turn === 'white') rows[0].classList.add('active');
            else rows[1].classList.add('active');
        }
    }, 50);
}

// attach handlers to the add/remove controls
document.getElementById('toggleClockBtn').addEventListener('click', () => {
    const form = document.getElementById('clock-form');
    if (!clockInstance) {
        // show form to configure
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
        return;
    }
    // if clock exists -> remove it
    removeClock();
});

// Cancel button in form
document.getElementById('cancelClockBtn').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('clock-form').style.display = 'none';
});

// Start clock button
document.getElementById('startClockBtn').addEventListener('click', (e) => {
    e.preventDefault();
    const whiteMin = parseFloat(document.getElementById('whiteMinutesInput').value) || 0;
    const blackMin = parseFloat(document.getElementById('blackMinutesInput').value) || 0;
    const incSec = parseFloat(document.getElementById('incrementInput').value) || 0;

    // if a clock exists already, remove it first
    if (clockStartTimerId) {
        clearTimeout(clockStartTimerId);
        clockStartTimerId = null;
    }

    // create a lightweight wrapper clock that supports per-player times
    // we slightly adapt GameClock to accept different white/black start times
    class GameClockCustom extends GameClock {
        constructor(whiteMinutes, blackMinutes, incrementSeconds) {
            super(0, incrementSeconds); // call parent to init increment
            this.whiteTime = whiteMinutes * 60 * 1000;
            this.blackTime = blackMinutes * 60 * 1000;
        }
        // keep other functions same
    }

    // instantiate but don't start immediately
    clockInstance = new GameClockCustom(whiteMin, blackMin, incSec);
    // אחרי: clockInstance = new GameClockCustom(whiteMin, blackMin, incSec);
    clockInstance.onFlag = (flaggedColor) => {
        // flaggedColor = 'white' אם לילדף הלבן נגמר הזמן
        // המנצח הוא הצד השני
        try {
            // עצור את השעון
            if (typeof clockInstance.stop === 'function') clockInstance.stop();
            // סמן משחק כגמור
            engine.isGameOver = true;

            const winner = (flaggedColor === 'white') ? 'השחור' : 'הלבן';
            // עדכן מודל התוצאה ומציג modal
            const modal = document.getElementById('game-over-modal');
            if (modal) {
                document.getElementById('winner-title').innerText = `${winner} ניצח בזמן!`;
                document.getElementById('end-reason').innerText = `הזמן של ${flaggedColor === 'white' ? 'הלבן' : 'השחור'} נגמר.`;
                modal.style.display = 'flex';
            } else {
                alert(`${winner} ניצח בזמן!`);
            }
            // עדכן סטטוס UI (שורת סטטוס)
            const statusEl = document.getElementById('status');
            if (statusEl) statusEl.innerText = `זמן נגמר — ${winner} ניצח`;
        } catch (err) {
            console.error('onFlag handler error', err);
        }
    };


    // update toggle button text / hide form
    document.getElementById('clock-form').style.display = 'none';
    document.getElementById('toggleClockBtn').innerText = 'הסר שעון';

    // schedule start after ~2s
    clockStartTimerId = setTimeout(() => {
        // start with engine.turn (current player)
        clockInstance.start(engine.turn);
        clockStartTimerId = null;
        ensureClocksRendering();
    }, 2000);

    // render UI immediately (even before counting starts)
    ensureClocksRendering();
});

// remove existing clock
function removeClock() {
    if (clockStartTimerId) { clearTimeout(clockStartTimerId); clockStartTimerId = null; }
    if (clocksRenderIntervalId) { clearInterval(clocksRenderIntervalId); clocksRenderIntervalId = null; }
    clockInstance = null;
    renderClocksUI();
    document.getElementById('toggleClockBtn').innerText = 'הוסף שעון';
    document.getElementById('clock-form').style.display = 'none';
}

// make sure the game integrates with clock switching:
// add this line in ChessUI.handleMove just after engine.makeMove(...) (you already added switchTurn earlier)
// keep: clock.switchTurn(this.engine.turn);
// If clockInstance may be null, guard it:
(function patchClockIntegration() {
    // we assume you already inserted 'clock.switchTurn(this.engine.turn)' earlier.
    // if you didn't, replace it with:
    // if (clockInstance) clockInstance.switchTurn(this.engine.turn);
    // To be safe, modify your handleMove line accordingly:
    // find: clock.switchTurn(this.engine.turn);
    // replace with: if (typeof clockInstance !== 'undefined' && clockInstance) clockInstance.switchTurn(this.engine.turn);
})();
/* ---------- Move list rendering helpers ---------- */

// המרת קואורדינטות engine (r,c) לשם משבצת בשיטה האלגברית: a1..h8
function squareName(r, c) {
    const file = String.fromCharCode(97 + c); // 0->'a'
    const rank = 8 - r; // r=0 -> '8'
    return `${file}${rank}`;
}

// מקבל entry מה־moveHistory (המבנה שאתה שומר ב-history) ומחזיר מחרוזת קריאה
function formatHistoryEntry(entry) {
    if (!entry) return '';

    // support both full historyEntry (engine.moveHistory entries) and minimal masterHistory entries
    // full entry: entry.from.piece etc.
    // minimal entry: entry.piece, entry.from.r/c, entry.to.r/c, entry.promotion
    const fromR = entry.from && (entry.from.r !== undefined) ? entry.from.r : (entry.from ? entry.from.r : null);
    const fromC = entry.from && (entry.from.c !== undefined) ? entry.from.c : (entry.from ? entry.from.c : null);
    const toR = entry.to && (entry.to.r !== undefined) ? entry.to.r : (entry.to ? entry.to.r : null);
    const toC = entry.to && (entry.to.c !== undefined) ? entry.to.c : (entry.to ? entry.to.c : null);

    const piece = (entry.from && entry.from.piece) ? entry.from.piece : (entry.piece ? entry.piece : null);
    const special = entry.special || {};
    const promotionPiece = entry.promotionPiece || entry.promotion || null;

    // castle detection (if present in special)
    if (special.isCastle === 'k') return 'O-O';
    if (special.isCastle === 'q') return 'O-O-O';

    const pieceType = piece ? piece.toLowerCase() : null;
    const fromSq = (fromR !== null && fromC !== null) ? squareName(fromR, fromC) : '';
    const toSq = (toR !== null && toC !== null) ? squareName(toR, toC) : '';

    const isCapture = (entry.to && entry.to.captured) || (special && special.isEnPassant) || false;

    const promo = promotionPiece ? `=${promotionPiece.toUpperCase()}` : '';

    if (pieceType === 'p') {
        const sep = isCapture ? 'x' : '-';
        let s = `${fromSq}${sep}${toSq}`;
        if (special && special.isEnPassant) s += ' e.p.';
        if (promo) s += promo;
        return s;
    } else {
        const letter = piece ? piece.toUpperCase() : '';
        const sep = isCapture ? 'x' : '-';
        let s = `${letter}${fromSq}${sep}${toSq}`;
        if (promo) s += promo;
        return s;
    }
}

// render the whole move list into #move-list
function renderMoveList() {
    const container = document.getElementById('move-list');
    if (!container) return;
    container.innerHTML = '';

    const hist = engine.moveHistory || [];
    // build rows: each row contains move number, white move, black move
    for (let i = 0; i < hist.length; i += 2) {
        const whiteEntry = hist[i];
        const blackEntry = hist[i + 1];

        const row = document.createElement('div');
        row.className = 'move-row';

        const moveNum = document.createElement('div');
        moveNum.className = 'move-num';
        moveNum.innerText = `${Math.floor(i / 2) + 1}.`;

        const wDiv = document.createElement('div');
        wDiv.className = 'move-white';
        if (whiteEntry) {
            wDiv.innerText = formatHistoryEntry(whiteEntry);
            wDiv.classList.add('clickable-move');
            wDiv.onclick = () => ui.goToMove(i);
        }

        const bDiv = document.createElement('div');
        bDiv.className = 'move-black';
        if (blackEntry) {
            bDiv.innerText = formatHistoryEntry(blackEntry);
            bDiv.classList.add('clickable-move');
            bDiv.onclick = () => ui.goToMove(i + 1);
        }


        row.appendChild(moveNum);
        row.appendChild(wDiv);
        row.appendChild(bDiv);

        container.appendChild(row);
    }

    // אם יש מספר אי-זוגי של מהלכים (מהלך לבן אחרון) - אפשר לגלול למטה אוטומטית
    container.scrollTop = container.scrollHeight;
}

// initial state: ensure no clock rendering
ensureClocksRendering();


// attach safe listeners for buttons (optional but recommended)
document.addEventListener('DOMContentLoaded', () => {
    const modalResetBtn = document.getElementById('modalResetBtn');
    if (modalResetBtn) modalResetBtn.addEventListener('click', () => { if (window.game && window.game.reset) window.game.reset(); });

    // גם לחצנים הראשיים (אם תרצה להוסיף כפילות)
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => { if (window.game && window.game.reset) window.game.reset(); });

    const flipBtn = document.getElementById('flipBtn');
    if (flipBtn) flipBtn.addEventListener('click', () => { if (window.game && window.game.flipBoard) window.game.flipBoard(); });

    const toggleAiBtn = document.getElementById('toggleAiBtn');
    const aiControls = document.getElementById('ai-controls');

    toggleAiBtn.addEventListener('click', () => {
        aiEnabled = !aiEnabled;
        document.getElementById('ai-status').textContent = aiEnabled ? 'פעיל' : 'כבוי';

        if (aiControls) aiControls.style.display = aiEnabled ? 'block' : 'none'; // <--- חשוב

        if (!window.aiPlayer) return;

        if (aiEnabled && engine.turn === aiColor && !aiPlayer.isRunning) {
            aiPlayer.startAs(aiColor);
        } else if (!aiEnabled) {
            aiPlayer.stop();
        }
    });





    const redoBtn = document.getElementById('redoBtn');
    if (redoBtn) {
        redoBtn.addEventListener('click', () => {
            if (window.game && window.game.redo) window.game.redo();
        });
    }
    const chk = document.getElementById('allowPreviewUndoCheckbox');
    if (chk) {
        // initial state from ui if exists
        chk.checked = (ui && ui.allowUndoWhilePreview) ? true : false;
        chk.addEventListener('change', () => {
            if (ui) ui.allowUndoWhilePreview = chk.checked;
        });
    }
    // אופציונלי: קיצורי מקלדת (Ctrl+Z / Ctrl+Y או Ctrl+Shift+Z)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault(); if (window.game && window.game.undo) window.game.undo();
        }
        if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
            ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
            e.preventDefault(); if (window.game && window.game.redo) window.game.redo();
        }
    });
    // ===== AI depth control =====
    // ===== AI depth control =====
    const depthInput = document.getElementById('aiDepthInput');

    if (depthInput) {
        depthInput.addEventListener('change', () => {
            if (!aiEnabled || !window.aiPlayer) return;

            const depth = parseInt(depthInput.value, 10) || 3;
            if (typeof window.aiPlayer.setDepth === 'function') {
                window.aiPlayer.setDepth(depth);
                console.log('AI depth set to', depth);
            }
        });
    }




});


// יצירת כפתור Live מעל המהלכים בצד שמאל
(function () {
    const movesHeader = document.querySelector('.moves-panel-header h3');
    if (!movesHeader) return;

    // בדיקה אם הכפתור כבר קיים
    let liveBtn = document.getElementById('moves-live-btn');
    if (!liveBtn) {
        liveBtn = document.createElement('button');
        liveBtn.id = 'moves-live-btn';
        liveBtn.textContent = 'Live';
        liveBtn.className = 'btn'; // תתאם את הסגנון שלך
        liveBtn.style.display = 'none'; // נסתר כברירת מחדל
        liveBtn.style.marginLeft = '10px'; // רווח מהכותרת
        liveBtn.style.verticalAlign = 'middle';

        // מכניסים את הכפתור אחרי הכותרת בתוך ה־header
        movesHeader.parentNode.insertBefore(liveBtn, movesHeader.nextSibling);

        // לחיצה על הכפתור יוצאת ממצב Preview
        liveBtn.addEventListener('click', () => {
            if (ui && ui.exitPreview) ui.exitPreview();
        });
    }

    // עדכון התצוגה בהתאם לפריוויו
    if (ui && ui.updateControlStates) ui.updateControlStates();
})();
