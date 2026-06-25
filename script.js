console.log('Chess build: 2026-06-24 rebuilt-final');
const PIECE_IMAGES = {
    'P': 'wp.png', 'R': 'wr.png', 'N': 'wn.png', 'B': 'wb.png', 'Q': 'wq.png', 'K': 'wk.png',
    'p': 'bp.png', 'r': 'br.png', 'n': 'bn.png', 'b': 'bb.png', 'q': 'bq.png', 'k': 'bk.png'
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
        this.gameResult = null; // 'white' | 'black' | 'draw' | null
        this.enPassantTarget = null;
        this.castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
        this.lastMove = null;
        this.moveHistory = [];
        this.redoStack = [];
        this.masterHistory = [];
        this.halfmoveClock = 0;
        this.positionCount = new Map();
        this.positionCount.set(this.getPositionKey(), 1);
    }
    // \u05DE\u05D7\u05D6\u05D9\u05E8 \u05DE\u05D7\u05E8\u05D5\u05D6\u05EA \u05DE\u05D9\u05D9\u05E6\u05D2\u05EA \u05DE\u05E6\u05D1 (FEN \u05D7\u05DC\u05E7\u05D9): board turn castling enPassant
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
    // \u05D4\u05D0\u05DD \u05D9\u05E9 \u05D7\u05D5\u05DE\u05E8 \u05DC\u05D0 \u05DE\u05E1\u05E4\u05D9\u05E7 \u05DC\u05E9\u05D7\u05E7 (\u05EA\u05D9\u05E7\u05D5)
    hasInsufficientMaterial() {
        const pieces = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p) pieces.push(p.toLowerCase());
            }
        }

        // \u05E8\u05E7 \u05DE\u05DC\u05DB\u05D9\u05DD
        if (pieces.length === 2) return true;

        // K + (B|N) vs K
        if (pieces.length === 3) {
            // \u05D0\u05DD \u05D0\u05D7\u05D3 \u05D4\u05DB\u05DC\u05D9\u05DD \u05D4\u05D5\u05D0 \u05D1\u05D9\u05E9\u05D5\u05E3 \u05D0\u05D5 \u05E4\u05E8\u05E9 -> insufficient
            return pieces.includes('b') || pieces.includes('n');
        }

        // K+B vs K+B \u05D5\u05D9\u05E9 \u05DC\u05E9\u05E0\u05D9 \u05D4\u05D1\u05D9\u05E9\u05D5\u05E4\u05D9\u05DD \u05D0\u05D5\u05EA\u05D5 \u05E6\u05D1\u05E2 \u05DE\u05E9\u05D1\u05E6\u05EA
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
        const piece = this.getPiece(r, c);
        if (!piece || colorOf(piece) !== this.turn) return [];

        let moves = this.getPseudoMoves(r, c);
        if (piece.toLowerCase() === 'k') {
            moves = moves.concat(this.getCastleMoves(r, c, piece));
        }

        return moves.filter(move =>
            !this.testMoveLeavesKingInCheck(r, c, move.r, move.c, move)
        );
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
                const adjacent = this.getPiece(r, nc);
                const expectedPawn = p === 'P' ? 'p' : 'P';
                if (adjacent === expectedPawn) {
                    moves.push({ r: nr, c: nc, isEnPassant: true, promotion: false });
                }
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
        const moves = [];
        const color = isUpper(p) ? 'white' : 'black';
        const homeRow = color === 'white' ? 7 : 0;
        const kingPiece = color === 'white' ? 'K' : 'k';
        const rookPiece = color === 'white' ? 'R' : 'r';
        const enemyColor = color === 'white' ? 'black' : 'white';

        // Castling is legal only from the original king square.
        if (r !== homeRow || c !== 4 || p !== kingPiece || this.isKingInCheck(color)) return moves;

        const kingRight = color === 'white' ? 'wK' : 'bK';
        if (this.castlingRights[kingRight] && this.getPiece(homeRow, 7) === rookPiece &&
            !this.getPiece(homeRow, 5) && !this.getPiece(homeRow, 6) &&
            !this.isSquareAttacked(homeRow, 5, enemyColor) &&
            !this.isSquareAttacked(homeRow, 6, enemyColor)) {
            moves.push({ r: homeRow, c: 6, isCastle: 'k' });
        }

        const queenRight = color === 'white' ? 'wQ' : 'bQ';
        if (this.castlingRights[queenRight] && this.getPiece(homeRow, 0) === rookPiece &&
            !this.getPiece(homeRow, 1) && !this.getPiece(homeRow, 2) && !this.getPiece(homeRow, 3) &&
            !this.isSquareAttacked(homeRow, 3, enemyColor) &&
            !this.isSquareAttacked(homeRow, 2, enemyColor)) {
            moves.push({ r: homeRow, c: 2, isCastle: 'q' });
        }

        return moves;
    }

    isSquareAttacked(targetR, targetC, byColor) {
        // Pawns attack diagonally only; their forward moves are not attacks.
        const pawn = byColor === 'white' ? 'P' : 'p';
        const pawnRow = targetR + (byColor === 'white' ? 1 : -1);
        for (const dc of [-1, 1]) {
            const c = targetC + dc;
            if (inBounds(pawnRow, c) && this.board[pawnRow][c] === pawn) return true;
        }

        const knight = byColor === 'white' ? 'N' : 'n';
        const knightOffsets = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
        for (const [dr, dc] of knightOffsets) {
            const r = targetR + dr, c = targetC + dc;
            if (inBounds(r, c) && this.board[r][c] === knight) return true;
        }

        const king = byColor === 'white' ? 'K' : 'k';
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (!dr && !dc) continue;
                const r = targetR + dr, c = targetC + dc;
                if (inBounds(r, c) && this.board[r][c] === king) return true;
            }
        }

        const rook = byColor === 'white' ? 'R' : 'r';
        const bishop = byColor === 'white' ? 'B' : 'b';
        const queen = byColor === 'white' ? 'Q' : 'q';
        const lines = [
            [1,0,rook],[-1,0,rook],[0,1,rook],[0,-1,rook],
            [1,1,bishop],[1,-1,bishop],[-1,1,bishop],[-1,-1,bishop]
        ];
        for (const [dr, dc, piece] of lines) {
            let r = targetR + dr, c = targetC + dc;
            while (inBounds(r, c)) {
                const found = this.board[r][c];
                if (found) {
                    if (found === piece || found === queen) return true;
                    break;
                }
                r += dr; c += dc;
            }
        }
        return false;
    }

    isKingInCheck(color) {
        const kingChar = color === 'white' ? 'K' : 'k';
        let kingR = -1, kingC = -1;
        for (let r = 0; r < 8 && kingR < 0; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.board[r][c] === kingChar) { kingR = r; kingC = c; break; }
            }
        }
        if (kingR < 0) return true;
        return this.isSquareAttacked(kingR, kingC, color === 'white' ? 'black' : 'white');
    }

    testMoveLeavesKingInCheck(fromR, fromC, toR, toC, moveObject = null) {
        const piece = this.board[fromR][fromC];
        if (!piece) return true;

        const captured = this.board[toR][toC];
        let capturedEnPassant = null;
        if (moveObject && moveObject.isEnPassant) {
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
        if (this.isGameOver) return false;

        const piece = this.getPiece(fromR, fromC);
        if (!piece || colorOf(piece) !== this.turn) return false;

        const moveData = this.getLegalMoves(fromR, fromC)
            .find(m => m.r === toR && m.c === toC);
        if (!moveData) return false;

        if (moveData.promotion) {
            const allowed = isUpper(piece) ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];
            if (!allowed.includes(promotionPiece)) return false;
        } else {
            promotionPiece = null;
        }

        const prevEnPassant = this.enPassantTarget ? { ...this.enPassantTarget } : null;
        const prevLastMove = this.lastMove ? JSON.parse(JSON.stringify(this.lastMove)) : null;
        const historyEntry = {
            from: { r: fromR, c: fromC, piece },
            to: { r: toR, c: toC, captured: null, capturedPos: null },
            special: { ...moveData },
            prevTurn: this.turn,
            prevEnPassant,
            prevCastling: { ...this.castlingRights },
            prevHalfmoveClock: this.halfmoveClock,
            prevPositionCount: new Map(this.positionCount),
            prevIsGameOver: this.isGameOver,
            prevGameResult: this.gameResult,
            prevLastMove
        };

        if (moveData.isEnPassant) {
            historyEntry.to.captured = this.board[fromR][toC];
            historyEntry.to.capturedPos = { r: fromR, c: toC };
            this.board[fromR][toC] = null;
        } else {
            historyEntry.to.captured = this.board[toR][toC];
            historyEntry.to.capturedPos = { r: toR, c: toC };
        }

        const capturedPiece = historyEntry.to.captured;
        const capturedPos = historyEntry.to.capturedPos;

        this.board[toR][toC] = piece;
        this.board[fromR][fromC] = null;

        if (moveData.isCastle === 'k') {
            this.board[toR][toC - 1] = this.board[toR][7];
            this.board[toR][7] = null;
        } else if (moveData.isCastle === 'q') {
            this.board[toR][toC + 1] = this.board[toR][0];
            this.board[toR][0] = null;
        }

        if (moveData.promotion) {
            this.board[toR][toC] = promotionPiece;
            historyEntry.promotionPiece = promotionPiece;
        }

        if (piece === 'K') { this.castlingRights.wK = false; this.castlingRights.wQ = false; }
        if (piece === 'k') { this.castlingRights.bK = false; this.castlingRights.bQ = false; }
        if (piece === 'R' && fromR === 7 && fromC === 7) this.castlingRights.wK = false;
        if (piece === 'R' && fromR === 7 && fromC === 0) this.castlingRights.wQ = false;
        if (piece === 'r' && fromR === 0 && fromC === 7) this.castlingRights.bK = false;
        if (piece === 'r' && fromR === 0 && fromC === 0) this.castlingRights.bQ = false;

        if (capturedPiece === 'R' && capturedPos.r === 7 && capturedPos.c === 7) this.castlingRights.wK = false;
        if (capturedPiece === 'R' && capturedPos.r === 7 && capturedPos.c === 0) this.castlingRights.wQ = false;
        if (capturedPiece === 'r' && capturedPos.r === 0 && capturedPos.c === 7) this.castlingRights.bK = false;
        if (capturedPiece === 'r' && capturedPos.r === 0 && capturedPos.c === 0) this.castlingRights.bQ = false;

        this.enPassantTarget = moveData.isDouble
            ? { r: Math.floor((fromR + toR) / 2), c: toC }
            : null;

        this.lastMove = {
            from: { r: fromR, c: fromC },
            to: { r: toR, c: toC },
            special: { ...moveData }
        };

        const isPawnMove = piece.toLowerCase() === 'p';
        this.halfmoveClock = (isPawnMove || capturedPiece)
            ? 0
            : this.halfmoveClock + 1;

        this.turn = this.turn === 'white' ? 'black' : 'white';

        const positionKey = this.getPositionKey();
        this.positionCount.set(positionKey, (this.positionCount.get(positionKey) || 0) + 1);

        const endResult = this.checkGameOver();
        if (endResult) {
            this.isGameOver = true;
            this.gameResult = (endResult === 'checkmate')
                ? (this.turn === 'white' ? 'black' : 'white')
                : 'draw';
        } else {
            this.isGameOver = false;
            this.gameResult = null;
        }

        historyEntry.postTurn = this.turn;
        historyEntry.postEnPassant = this.enPassantTarget ? { ...this.enPassantTarget } : null;
        historyEntry.postCastling = { ...this.castlingRights };
        historyEntry.postHalfmoveClock = this.halfmoveClock;
        historyEntry.postPositionCount = new Map(this.positionCount);
        historyEntry.postIsGameOver = this.isGameOver;
        historyEntry.postGameResult = this.gameResult;
        historyEntry.postLastMove = this.lastMove ? JSON.parse(JSON.stringify(this.lastMove)) : null;
        historyEntry.endResult = endResult;

        this.moveHistory.push(historyEntry);
        this.redoStack = [];
        this.masterHistory.push({
            from: { r: fromR, c: fromC },
            to: { r: toR, c: toC },
            promotion: historyEntry.promotionPiece || null,
            piece
        });

        return endResult;
    }
// --------------- undoMove / redoMove ---------------
    undoMove() {
        if (!this.moveHistory.length) return false;

        const entry = this.moveHistory.pop();
        this.redoStack.push(entry);
        if (this.masterHistory.length) this.masterHistory.pop();

        this.board[entry.from.r][entry.from.c] = entry.from.piece;

        if (entry.special.isEnPassant) {
            this.board[entry.to.r][entry.to.c] = null;
            const cap = entry.to.capturedPos;
            this.board[cap.r][cap.c] = entry.to.captured;
        } else {
            this.board[entry.to.r][entry.to.c] = entry.to.captured || null;
        }

        if (entry.special.isCastle === 'k') {
            this.board[entry.to.r][7] = this.board[entry.to.r][entry.to.c - 1];
            this.board[entry.to.r][entry.to.c - 1] = null;
        } else if (entry.special.isCastle === 'q') {
            this.board[entry.to.r][0] = this.board[entry.to.r][entry.to.c + 1];
            this.board[entry.to.r][entry.to.c + 1] = null;
        }

        this.turn = entry.prevTurn;
        this.enPassantTarget = entry.prevEnPassant ? { ...entry.prevEnPassant } : null;
        this.castlingRights = { ...entry.prevCastling };
        this.halfmoveClock = entry.prevHalfmoveClock;
        this.positionCount = new Map(entry.prevPositionCount);
        this.isGameOver = entry.prevIsGameOver;
        this.gameResult = entry.prevGameResult || null;
        this.lastMove = entry.prevLastMove ? JSON.parse(JSON.stringify(entry.prevLastMove)) : null;
        return true;
    }

    redoMove() {
        if (!this.redoStack.length) return false;

        const entry = this.redoStack.pop();
        const { r: fromR, c: fromC } = entry.from;
        const { r: toR, c: toC } = entry.to;

        this.board[fromR][fromC] = null;

        if (entry.special.isEnPassant) {
            const cap = entry.to.capturedPos;
            this.board[cap.r][cap.c] = null;
        }

        this.board[toR][toC] = entry.promotionPiece || entry.from.piece;

        if (entry.special.isCastle === 'k') {
            this.board[toR][toC - 1] = this.board[toR][7];
            this.board[toR][7] = null;
        } else if (entry.special.isCastle === 'q') {
            this.board[toR][toC + 1] = this.board[toR][0];
            this.board[toR][0] = null;
        }

        this.turn = entry.postTurn;
        this.enPassantTarget = entry.postEnPassant ? { ...entry.postEnPassant } : null;
        this.castlingRights = { ...entry.postCastling };
        this.halfmoveClock = entry.postHalfmoveClock;
        this.positionCount = new Map(entry.postPositionCount);
        this.isGameOver = entry.postIsGameOver;
        this.gameResult = entry.postGameResult || null;
        this.lastMove = entry.postLastMove ? JSON.parse(JSON.stringify(entry.postLastMove)) : null;

        this.moveHistory.push(entry);
        this.masterHistory.push({
            from: { r: fromR, c: fromC },
            to: { r: toR, c: toC },
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

        // threefold repetition: \u05D1\u05D3\u05D5\u05E7 \u05D0\u05EA \u05D4\u05DE\u05E4\u05EA\u05D7 \u05D4\u05E0\u05D5\u05DB\u05D7\u05D9
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
        copy.board = this.board.map(row => row.slice());
        copy.turn = this.turn;
        copy.isGameOver = this.isGameOver;
        copy.gameResult = this.gameResult;
        copy.enPassantTarget = this.enPassantTarget ? { ...this.enPassantTarget } : null;
        copy.castlingRights = { ...this.castlingRights };
        copy.lastMove = this.lastMove ? JSON.parse(JSON.stringify(this.lastMove)) : null;
        copy.moveHistory = this.moveHistory ? JSON.parse(JSON.stringify(this.moveHistory)) : [];
        copy.redoStack = this.redoStack ? JSON.parse(JSON.stringify(this.redoStack)) : [];
        copy.halfmoveClock = this.halfmoveClock;
        copy.positionCount = new Map(this.positionCount);
        copy.masterHistory = this.masterHistory ? JSON.parse(JSON.stringify(this.masterHistory)) : [];
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
        if (!this.running) {
            this.turn = newTurn;
            this.lastTimestamp = performance.now();
            return;
        }

        this._tick();
        if (!this.running) return; // \u05D4\u05D6\u05DE\u05DF \u05E0\u05D2\u05DE\u05E8 \u05D1\u05DE\u05D4\u05DC\u05DA \u05D4-tick

        if (this.turn === 'white') this.whiteTime += this.increment;
        else this.blackTime += this.increment;

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


    goToMove(moveIndex) {
        // \u05E6\u05D5\u05E8 engine \u05D7\u05D3\u05E9 \u05D5\u05E0\u05E7\u05D9
        const preview = new ChessEngine();
        preview.reset();

        // \u05E9\u05D7\u05E7 \u05E2\u05D3 \u05D4\u05DE\u05D4\u05DC\u05DA \u05D4\u05DE\u05D1\u05D5\u05E7\u05E9
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
        // \u05E7\u05D1\u05DC \u05D0\u05EA \u05D4\u05DE\u05D4\u05DC\u05DA \u05D4\u05D7\u05D5\u05E7\u05D9 (\u05D0\u05DD \u05E7\u05D9\u05D9\u05DD) \u05D1\u05DE\u05E7\u05D5\u05DD \u05D1\u05D3\u05D9\u05E7\u05D4 \u05D1\u05D5\u05DC\u05D9\u05D0\u05E0\u05D9\u05EA \u05D1\u05DC\u05D1\u05D3
        const legalMoves = this.engine.getLegalMoves(from.r, from.c);
        const legalMove = legalMoves.find(m => m.r === to.r && m.c === to.c);

        // \u05D0\u05DD \u05D4\u05DE\u05D4\u05DC\u05DA \u05DC\u05D0 \u05D7\u05D5\u05E7\u05D9 \u2014 \u05E0\u05E7\u05D9\u05DD \u05DE\u05E6\u05D1 \u05D5\u05E0\u05E9\u05E8\u05D8\u05D8 \u05DC\u05D5\u05D7 \u05D5\u05DC\u05D0 \u05E0\u05E2\u05E9\u05D4 \u05DB\u05DC\u05D5\u05DD \u05D0\u05D7\u05E8
        if (!legalMove) {
            this.selectedSquare = null;
            this.possibleMoves = [];
            this.renderBoard();
            return;
        }

        // \u05D0\u05DD \u05D6\u05D4 \u05DE\u05D4\u05DC\u05DA \u05E7\u05D9\u05D3\u05D5\u05DD \u05D7\u05D5\u05E7\u05D9 \u05D0\u05D1\u05DC \u05D0\u05D9\u05DF \u05E2\u05D3\u05D9\u05D9\u05DF \u05D1\u05D7\u05D9\u05E8\u05EA \u05E7\u05D9\u05D3\u05D5\u05DD \u2014 \u05D1\u05E7\u05E9 \u05D1\u05D7\u05D9\u05E8\u05D4 \u05D5\u05D0\u05D6 \u05D7\u05D6\u05D5\u05E8 \u05DC\u05E4\u05D5\u05E0\u05E7\u05E6\u05D9\u05D4
        if (legalMove.promotion && !promotion) {
            // askPromotion \u05DE\u05D7\u05D6\u05D9\u05E8\u05D4 Promise (\u05D4\u05E7\u05D9\u05D9\u05DE\u05EA \u05D1\u05E7\u05D5\u05D3 \u05E9\u05DC\u05DA), \u05DC\u05DB\u05DF \u05E0\u05D8\u05E4\u05DC \u05D1\u05BEthen
            this.askPromotion(this.engine.turn).then(chosen => {
                // \u05DB\u05D0\u05E9\u05E8 \u05D4\u05DE\u05E9\u05EA\u05DE\u05E9 \u05D1\u05D7\u05E8 \u05DB\u05DC\u05D9 \u2014 \u05E0\u05D1\u05E6\u05E2 \u05D0\u05EA \u05D4\u05DE\u05D4\u05DC\u05DA \u05E2\u05DD \u05D4\u05E7\u05D9\u05D3\u05D5\u05DD
                this.handleMove(from, to, chosen);
            }).catch(() => {
                // \u05D1\u05DE\u05E7\u05E8\u05D4 \u05D5\u05D4\u05DE\u05E9\u05EA\u05DE\u05E9 \u05D1\u05D9\u05D8\u05DC \u05D0\u05EA \u05EA\u05E4\u05E8\u05D9\u05D8 \u05D4\u05E7\u05D9\u05D3\u05D5\u05DD \u2014 \u05E8\u05E7 \u05E0\u05E1\u05D3\u05E8 UI \u05DE\u05D7\u05D3\u05E9
                this.selectedSquare = null;
                this.possibleMoves = [];
                this.renderBoard();
            });
            return; // \u05D7\u05E9\u05D5\u05D1 \u2014 \u05DC\u05D0 \u05DC\u05D1\u05E6\u05E2 \u05D0\u05EA \u05D4\u05DE\u05D4\u05DC\u05DA \u05E2\u05DB\u05E9\u05D9\u05D5
        }

        // \u05E2\u05DB\u05E9\u05D9\u05D5 \u05D4\u05DE\u05D4\u05DC\u05DA \u05D7\u05D5\u05E7\u05D9 (\u05D5\u05D0\u05DD \u05E6\u05E8\u05D9\u05DA \u05E7\u05D9\u05D3\u05D5\u05DD \u2014 \u05D4\u05D5\u05D0 \u05DB\u05D1\u05E8 \u05E0\u05D1\u05D7\u05E8 \u05D5\u05E2\u05DE\u05D3 \u05D1\u05E4\u05E8\u05DE\u05D8\u05E8 promotion)
        const result = this.engine.makeMove(from.r, from.c, to.r, to.c, promotion);

        // \u05E2\u05D3\u05DB\u05D5\u05DF \u05D4\u05E9\u05E2\u05D5\u05DF (\u05D0\u05DD \u05E7\u05D9\u05D9\u05DD)
        if (typeof clockInstance !== 'undefined' && clockInstance) {
            clockInstance.switchTurn(this.engine.turn);
        }

        // \u05E0\u05E0\u05E7\u05D4 \u05D1\u05D7\u05D9\u05E8\u05D4 \u05D5\u05E0\u05E8\u05E0\u05D3\u05E8 \u05DC\u05D5\u05D7
        this.selectedSquare = null;
        this.possibleMoves = [];
        this.renderBoard();

        // \u05E2\u05D3\u05DB\u05D5\u05DF \u05E8\u05E9\u05D9\u05DE\u05EA \u05D4\u05DE\u05D4\u05DC\u05DB\u05D9\u05DD \u2014 \u05E8\u05E7 \u05D0\u05D7\u05E8\u05D9 \u05E9\u05D4\u05DE\u05D4\u05DC\u05DA \u05D1\u05D5\u05E6\u05E2 \u05D5\u05D4\u05D9\u05E1\u05D8\u05D5\u05E8\u05D9\u05D9\u05EA \u05D4\u05DE\u05D4\u05DC\u05DB\u05D9\u05DD \u05E2\u05D5\u05D3\u05DB\u05E0\u05D4
        if (typeof renderMoveList === 'function') renderMoveList();

        // \u05D1\u05D3\u05D9\u05E7\u05EA \u05E1\u05D9\u05D5\u05DD \u05DE\u05E9\u05D7\u05E7
        if (result) {
            if (typeof clockInstance !== 'undefined' && clockInstance && typeof clockInstance.stop === 'function') {
                clockInstance.stop();
            }
            this.showGameOver(result);
        }
    }

    /* -- \u05D4\u05DE\u05E8\u05D5\u05EA UI <-> Engine -- */
    uiToEngineCoords(uiR, uiC) {
        if (!this.isFlipped) return { r: uiR, c: uiC };
        return { r: 7 - uiR, c: 7 - uiC };
    }
    engineToUiCoords(r, c) {
        if (!this.isFlipped) return { r, c };
        return { r: 7 - r, c: 7 - c };
    }

    /* -- renderBoard \u05DE\u05E9\u05EA\u05DE\u05E9 \u05D1-UI \u05E7\u05D5\u05D0\u05D5\u05E8\u05D3\u05D9\u05E0\u05D8\u05D5\u05EA (uiR,uiC) \u05D5\u05D0\u05D6 \u05DE\u05DE\u05E4\u05D4 \u05DC-engine -- */
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
        if (statusEl) statusEl.innerText = `\u05EA\u05D5\u05E8: ${engineToUse.turn === 'white' ? "\u05DC\u05D1\u05DF" : "\u05E9\u05D7\u05D5\u05E8"}`;

        for (let uiR = 0; uiR < 8; uiR++) {
            for (let uiC = 0; uiC < 8; uiC++) {
                const { r, c } = this.uiToEngineCoords(uiR, uiC);

                const sq = document.createElement('div');
                sq.addEventListener('dragover', (e) => {
                    e.preventDefault(); // \u05D7\u05D5\u05D1\u05D4
                });

                // drop handler MUST use the real engine (we'll keep the same behavior as before).
                // If preview is active, ignore drops (don't allow changing live game via preview).
                sq.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    if (!canPlayerMove()) return; // \u274C \u05D7\u05E1\u05D5\u05DD \u05D0\u05DD \u05D6\u05D4 \u05EA\u05D5\u05E8 AI
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

                // \u05E1\u05D9\u05DE\u05D5\u05DF \u05DE\u05D4\u05DC\u05DA \u05D0\u05D7\u05E8\u05D5\u05DF (\u05DE\u05BEengineToUse \u2014 \u05DB\u05DC\u05D5\u05DE\u05E8 \u05D2\u05DD preview \u05D9\u05E6\u05D9\u05D2 \u05DE\u05D4\u05DC\u05DA \u05D0\u05D7\u05E8\u05D5\u05DF \u05E0\u05DB\u05D5\u05DF)
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

                // \u05E1\u05D9\u05DE\u05D5\u05DF \u05DE\u05D4\u05DC\u05DB\u05D9\u05DD \u05D0\u05E4\u05E9\u05E8\u05D9\u05D9\u05DD - only when not in preview (possibleMoves belong to live engine)
                const moveHint = (!this.previewEngine) ? this.possibleMoves.find(m => m.r === r && m.c === c) : null;
                if (moveHint) {
                    if (this.engine.getPiece(r, c)) sq.classList.add('hint-capture');
                    else sq.classList.add('hint-move');
                }

                // use engineToUse to read pieces for display
                const p = engineToUse.getPiece(r, c);
                if (p) {
                    const img = document.createElement('img');
                    img.className = 'piece-img';
                    // draggable only when not in preview AND the piece belongs to the player to move on the live engine
                    img.draggable = !this.previewEngine;

                    if (!this.previewEngine) {
                        img.addEventListener('dragstart', (e) => {
                            if (!canPlayerMove()) { // \u274C \u05D7\u05E1\u05D5\u05DD \u05D0\u05DD \u05D6\u05D4 \u05EA\u05D5\u05E8 AI
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
                    img.alt = p;
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
    // \u05D1\u05EA\u05D5\u05DA \u05DE\u05D7\u05DC\u05E7\u05EA ChessUI
    updateControlStates() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        const liveBtn = document.getElementById('moves-live-btn'); // \u05D4\u05DB\u05E4\u05EA\u05D5\u05E8 Live \u05D0\u05DD \u05E7\u05D9\u05D9\u05DD

        // \u05DE\u05E6\u05D1 \u05D4\u05D0\u05DD \u05D0\u05E0\u05D7\u05E0\u05D5 \u05D1\u05E4\u05E8\u05D9\u05D5\u05D5\u05D9\u05D5
        const inPreview = !!this.previewEngine;
        // \u05D4\u05D0\u05DD \u05D4\u05DE\u05E9\u05EA\u05DE\u05E9 \u05D0\u05E4\u05E9\u05E8 \u05D1\u05D9\u05D8\u05D5\u05DC \u05D1\u05D6\u05DE\u05DF \u05E4\u05E8\u05D9\u05D5\u05D5\u05D9\u05D5 (\u05D3\u05D2\u05DC \u05E9\u05E0\u05DE\u05E6\u05D0 \u05D1\u05E7\u05D5\u05E0\u05E1\u05D8\u05E8\u05E7\u05D8\u05D5\u05E8)
        const allowWhilePreview = !!this.allowUndoWhilePreview;

        // \u05D0\u05DD \u05D0\u05E0\u05D7\u05E0\u05D5 \u05D1\u05E4\u05E8\u05D9\u05D5\u05D5\u05D9\u05D5 \u05D5\u05DC\u05D3\u05D2\u05DC \u05D0\u05D9\u05DF \u05D4\u05D9\u05EA\u05E8 - \u05D4\u05E9\u05D1\u05EA \u05DB\u05E4\u05EA\u05D5\u05E8\u05D9\u05DD
        if (undoBtn) {
            undoBtn.disabled = inPreview && !allowWhilePreview;
            if (undoBtn.disabled) undoBtn.classList.add('btn-disabled'); else undoBtn.classList.remove('btn-disabled');
        }
        if (redoBtn) {
            redoBtn.disabled = inPreview && !allowWhilePreview;
            if (redoBtn.disabled) redoBtn.classList.add('btn-disabled'); else redoBtn.classList.remove('btn-disabled');
        }

        // Live button: \u05DE\u05D5\u05E6\u05D2 \u05E8\u05E7 \u05D1\u05D6\u05DE\u05DF \u05E4\u05E8\u05D9\u05D5\u05D5\u05D9\u05D5 (\u05D0\u05D5\u05E4\u05E6\u05D9\u05D5\u05E0\u05DC\u05D9)
        if (liveBtn) {
            liveBtn.style.display = inPreview ? 'inline-block' : 'none';
        }
    }

    /* handleSquareClick \u05DE\u05E7\u05D1\u05DC UI \u05E7\u05D5\u05D0\u05D5\u05E8\u05D3\u05D9\u05E0\u05D8\u05D5\u05EA, \u05DE\u05DE\u05E4\u05D4 \u05DC-engine \u05D5\u05DE\u05E9\u05EA\u05DE\u05E9 \u05D1-engine \u05D1\u05DC\u05D1\u05D3 \u05DE\u05E2\u05DB\u05E9\u05D9\u05D5 */
    async handleSquareClick(uiR, uiC) {
        if (this.engine.isGameOver) return;

        const { r, c } = this.uiToEngineCoords(uiR, uiC);

        // \u05E0\u05D9\u05E1\u05D9\u05D5\u05DF \u05DC\u05D4\u05D6\u05D9\u05D6 \u05D0\u05DD \u05D9\u05E9 \u05D1\u05D7\u05D9\u05E8\u05D4
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

        // \u05D1\u05D7\u05D9\u05E8\u05EA \u05DB\u05DC\u05D9
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

    showGameOver(result) {
        const modal = document.getElementById('game-over-modal');
        if (!modal) return;

        const title = document.getElementById('winner-title');
        const reason = document.getElementById('end-reason');
        modal.style.display = 'flex';

        if (result === 'checkmate') {
            const winner = this.engine.turn === 'white' ? '\u05D4\u05E9\u05D7\u05D5\u05E8' : '\u05D4\u05DC\u05D1\u05DF';
            title.innerText = `\u05DE\u05D8! ${winner} \u05E0\u05D9\u05E6\u05D7!`;
            reason.innerText = `${winner} \u05E0\u05D9\u05E6\u05D7 \u05D1\u05D0\u05DE\u05E6\u05E2\u05D5\u05EA \u05DE\u05D8.`;
            if (typeof window.autoSaveFinishedGame === 'function') window.autoSaveFinishedGame();
            return;
        }

        const drawReason = typeof result === 'object' ? result.reason : null;
        const reasonMap = {
            '50-move rule': '\u05D7\u05D5\u05E7 \u05D7\u05DE\u05D9\u05E9\u05D9\u05DD \u05D4\u05DE\u05E1\u05E2\u05D9\u05DD',
            'threefold repetition': '\u05D7\u05D6\u05E8\u05D4 \u05DE\u05E9\u05D5\u05DC\u05E9\u05EA \u05E2\u05DC \u05D0\u05D5\u05EA\u05D4 \u05E2\u05DE\u05D3\u05D4',
            'insufficient material': '\u05D7\u05D5\u05E1\u05E8 \u05D7\u05D5\u05DE\u05E8 \u05DE\u05E1\u05E4\u05D9\u05E7 \u05DC\u05DE\u05D8'
        };
        title.innerText = '\u05EA\u05D9\u05E7\u05D5';
        reason.innerText = drawReason
            ? `\u05D4\u05DE\u05E9\u05D7\u05E7 \u05D4\u05E1\u05EA\u05D9\u05D9\u05DD \u05D1\u05EA\u05D9\u05E7\u05D5: ${reasonMap[drawReason] || drawReason}.`
            : '\u05D4\u05DE\u05E9\u05D7\u05E7 \u05D4\u05E1\u05EA\u05D9\u05D9\u05DD \u05D1\u05EA\u05D9\u05E7\u05D5 \u05DE\u05E9\u05D5\u05DD \u05E9\u05D0\u05D9\u05DF \u05DE\u05E1\u05E2\u05D9\u05DD \u05D7\u05D5\u05E7\u05D9\u05D9\u05DD.';
        if (typeof window.autoSaveFinishedGame === 'function') window.autoSaveFinishedGame();
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
const aiColor = 'black';
const aiPlayer = new SimpleAI(engine, ui);
window.aiPlayer = aiPlayer;

const initialDepthInput = document.getElementById('aiDepthInput');
aiPlayer.setDepth(initialDepthInput ? (parseInt(initialDepthInput.value, 10) || 3) : 3);

function canPlayerMove() {
    if (engine.isGameOver) return false;
    if (aiEnabled && engine.turn === aiColor) return false;
    return true;
}
window.canPlayerMove = canPlayerMove;

function isMultiplayerActive() {
    return !!(window.mp && window.mp.active);
}

function maybeAiMove() {
    if (!aiEnabled || isMultiplayerActive() || engine.isGameOver) return;
    if (engine.turn === aiColor && !aiPlayer.isRunning) {
        aiPlayer.startAs(aiColor);
    }
}

// \u05D4-hook \u05D7\u05DC \u05E8\u05E7 \u05E2\u05DC \u05DE\u05E0\u05D5\u05E2 \u05D4\u05DE\u05E9\u05D7\u05E7 \u05D4\u05D7\u05D9. \u05E2\u05D5\u05EA\u05E7\u05D9\u05DD \u05E9\u05D4-AI \u05D1\u05D5\u05D3\u05E7 \u05E0\u05E9\u05D0\u05E8\u05D9\u05DD \u05E0\u05E7\u05D9\u05D9\u05DD \u05DE\u05EA\u05D5\u05E4\u05E2\u05D5\u05EA \u05DC\u05D5\u05D5\u05D0\u05D9.
const originalMakeMove = engine.makeMove.bind(engine);
engine.makeMove = function (fromR, fromC, toR, toC, promotionPiece = null) {
    const result = originalMakeMove(fromR, fromC, toR, toC, promotionPiece);
    if (result !== false && !result) maybeAiMove();
    return result;
};

window.game = {
    undo: () => {
        if (isMultiplayerActive()) {
            alert('\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D1\u05D8\u05DC \u05DE\u05E1\u05E2\u05D9\u05DD \u05D1\u05DE\u05E9\u05D7\u05E7 \u05D0\u05D5\u05E0\u05DC\u05D9\u05D9\u05DF.');
            return;
        }
        if (ui.previewEngine && !ui.allowUndoWhilePreview) {
            alert('\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D1\u05D8\u05DC \u05D1\u05D6\u05DE\u05DF \u05E6\u05E4\u05D9\u05D9\u05D4 \u05D1\u05E2\u05D1\u05E8. \u05DC\u05D7\u05E5 Live \u05DB\u05D3\u05D9 \u05DC\u05D7\u05D6\u05D5\u05E8 \u05DC\u05DE\u05E9\u05D7\u05E7.');
            return;
        }

        aiPlayer.stop();
        let changed = engine.undoMove();
        // \u05D1\u05DE\u05E6\u05D1 AI \u05DE\u05D7\u05D6\u05D9\u05E8\u05D9\u05DD \u05D2\u05DD \u05D0\u05EA \u05DE\u05E1\u05E2 \u05D4\u05D0\u05D3\u05DD \u05D4\u05D0\u05D7\u05E8\u05D5\u05DF \u05DB\u05D3\u05D9 \u05DC\u05D7\u05D6\u05D5\u05E8 \u05DC\u05EA\u05D5\u05E8 \u05D4\u05D0\u05D3\u05DD.
        while (changed && aiEnabled && engine.turn === aiColor && engine.moveHistory.length) {
            engine.undoMove();
        }

        if (!changed) {
            alert('\u05D0\u05D9\u05DF \u05DE\u05E1\u05E2\u05D9\u05DD \u05DC\u05D1\u05D8\u05DC');
            return;
        }
        ui.exitPreview();
        ui.selectedSquare = null;
        ui.possibleMoves = [];
        ui.renderBoard();
        renderMoveList();
    },

    redo: () => {
        if (isMultiplayerActive()) {
            alert('\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D4\u05D7\u05D6\u05D9\u05E8 \u05DE\u05E1\u05E2\u05D9\u05DD \u05D1\u05DE\u05E9\u05D7\u05E7 \u05D0\u05D5\u05E0\u05DC\u05D9\u05D9\u05DF.');
            return;
        }
        if (ui.previewEngine && !ui.allowUndoWhilePreview) {
            alert('\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D4\u05D7\u05D6\u05D9\u05E8 \u05DE\u05E1\u05E2 \u05D1\u05D6\u05DE\u05DF \u05E6\u05E4\u05D9\u05D9\u05D4 \u05D1\u05E2\u05D1\u05E8. \u05DC\u05D7\u05E5 Live \u05DB\u05D3\u05D9 \u05DC\u05D7\u05D6\u05D5\u05E8 \u05DC\u05DE\u05E9\u05D7\u05E7.');
            return;
        }

        let changed = engine.redoMove();
        // \u05D0\u05DD \u05D4\u05DE\u05E1\u05E2 \u05E9\u05D4\u05D5\u05D7\u05D6\u05E8 \u05DE\u05E2\u05D1\u05D9\u05E8 \u05D0\u05EA \u05D4\u05EA\u05D5\u05E8 \u05DC-AI \u05D5\u05D9\u05E9 \u05DE\u05E1\u05E2 AI \u05E9\u05DE\u05D5\u05E8, \u05DE\u05D7\u05D6\u05D9\u05E8\u05D9\u05DD \u05D2\u05DD \u05D0\u05D5\u05EA\u05D5.
        if (changed && aiEnabled && engine.turn === aiColor && engine.redoStack.length) {
            engine.redoMove();
        }

        if (!changed) {
            alert('\u05D0\u05D9\u05DF \u05DE\u05E1\u05E2\u05D9\u05DD \u05DC\u05D4\u05D7\u05D6\u05D9\u05E8');
            return;
        }
        ui.exitPreview();
        ui.selectedSquare = null;
        ui.possibleMoves = [];
        ui.renderBoard();
        renderMoveList();
        if (engine.isGameOver && engine.moveHistory.length) {
            ui.showGameOver(engine.moveHistory[engine.moveHistory.length - 1].endResult);
        }
    },

    reset: () => {
        if (isMultiplayerActive()) {
            alert('\u05D1\u05DE\u05E9\u05D7\u05E7 \u05D0\u05D5\u05E0\u05DC\u05D9\u05D9\u05DF \u05D9\u05E9 \u05DC\u05D4\u05EA\u05E0\u05EA\u05E7 \u05DC\u05E4\u05E0\u05D9 \u05D4\u05EA\u05D7\u05DC\u05EA \u05DE\u05E9\u05D7\u05E7 \u05D7\u05D3\u05E9.');
            return;
        }
        if (!confirm('\u05DC\u05D4\u05EA\u05D7\u05D9\u05DC \u05DE\u05D7\u05D3\u05E9?')) return;

        aiPlayer.stop();
        engine.reset();
        if (typeof window.startNewSavedGame === 'function') window.startNewSavedGame();
        ui.exitPreview();
        ui.selectedSquare = null;
        ui.possibleMoves = [];
        ui.renderBoard();
        renderMoveList();

        if (clockInstance) {
            clockInstance.stop();
            removeClock();
        }
        const modal = document.getElementById('game-over-modal');
        if (modal) modal.style.display = 'none';
        maybeAiMove();
    },

    flipBoard: () => {
        ui.isFlipped = !ui.isFlipped;
        ui.selectedSquare = null;
        ui.possibleMoves = [];
        ui.renderBoard();
    },

    toggleAI: () => {
        if (isMultiplayerActive()) {
            alert('\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D4\u05E4\u05E2\u05D9\u05DC AI \u05D1\u05D6\u05DE\u05DF \u05DE\u05E9\u05D7\u05E7 \u05D0\u05D5\u05E0\u05DC\u05D9\u05D9\u05DF.');
            return;
        }

        aiEnabled = !aiEnabled;
        const statusSpan = document.getElementById('ai-status');
        const aiControls = document.getElementById('ai-controls');
        const depthInput = document.getElementById('aiDepthInput');

        if (statusSpan) statusSpan.textContent = aiEnabled ? '\u05E4\u05E2\u05D9\u05DC' : '\u05DB\u05D1\u05D5\u05D9';
        if (aiControls) aiControls.style.display = aiEnabled ? 'block' : 'none';

        if (aiEnabled) {
            aiPlayer.setDepth(depthInput ? (parseInt(depthInput.value, 10) || 3) : 3);
            maybeAiMove();
        } else {
            aiPlayer.stop();
        }
    },

    goLive: () => {
        ui.exitPreview();
        ui.selectedSquare = null;
        ui.possibleMoves = [];
        ui.renderBoard();
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
    if (!container) return;
    container.innerHTML = '';
    if (!clockInstance) {
        container.classList.add('no-clock');
        return;
    }
    container.classList.remove('no-clock');

    // White clock row
    const wRow = document.createElement('div');
    wRow.className = 'clock-row' + ((clockInstance.running && clockInstance.turn === 'white') ? ' active' : '');
    const wLabel = document.createElement('div'); wLabel.className = 'clock-label'; wLabel.innerText = '\u05DC\u05D1\u05DF';
    const wTime = document.createElement('div'); wTime.className = 'clock-time'; wTime.id = 'whiteClock';
    wRow.appendChild(wLabel); wRow.appendChild(wTime);
    container.appendChild(wRow);

    // Black clock row
    const bRow = document.createElement('div');
    bRow.className = 'clock-row' + ((clockInstance.running && clockInstance.turn === 'black') ? ' active' : '');
    const bLabel = document.createElement('div'); bLabel.className = 'clock-label'; bLabel.innerText = '\u05E9\u05D7\u05D5\u05E8';
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
    // \u05D0\u05D7\u05E8\u05D9: clockInstance = new GameClockCustom(whiteMin, blackMin, incSec);
    clockInstance.onFlag = (flaggedColor) => {
        // flaggedColor = 'white' \u05D0\u05DD \u05DC\u05D9\u05DC\u05D3\u05E3 \u05D4\u05DC\u05D1\u05DF \u05E0\u05D2\u05DE\u05E8 \u05D4\u05D6\u05DE\u05DF
        // \u05D4\u05DE\u05E0\u05E6\u05D7 \u05D4\u05D5\u05D0 \u05D4\u05E6\u05D3 \u05D4\u05E9\u05E0\u05D9
        try {
            // \u05E2\u05E6\u05D5\u05E8 \u05D0\u05EA \u05D4\u05E9\u05E2\u05D5\u05DF
            if (typeof clockInstance.stop === 'function') clockInstance.stop();
            // \u05E1\u05DE\u05DF \u05DE\u05E9\u05D7\u05E7 \u05DB\u05D2\u05DE\u05D5\u05E8
            engine.isGameOver = true;
            engine.gameResult = flaggedColor === 'white' ? 'black' : 'white';

            const winner = (flaggedColor === 'white') ? '\u05D4\u05E9\u05D7\u05D5\u05E8' : '\u05D4\u05DC\u05D1\u05DF';
            // \u05E2\u05D3\u05DB\u05DF \u05DE\u05D5\u05D3\u05DC \u05D4\u05EA\u05D5\u05E6\u05D0\u05D4 \u05D5\u05DE\u05E6\u05D9\u05D2 modal
            const modal = document.getElementById('game-over-modal');
            if (modal) {
                document.getElementById('winner-title').innerText = `${winner} \u05E0\u05D9\u05E6\u05D7 \u05D1\u05D6\u05DE\u05DF!`;
                document.getElementById('end-reason').innerText = `\u05D4\u05D6\u05DE\u05DF \u05E9\u05DC ${flaggedColor === 'white' ? '\u05D4\u05DC\u05D1\u05DF' : '\u05D4\u05E9\u05D7\u05D5\u05E8'} \u05E0\u05D2\u05DE\u05E8.`;
                modal.style.display = 'flex';
            } else {
                alert(`${winner} \u05E0\u05D9\u05E6\u05D7 \u05D1\u05D6\u05DE\u05DF!`);
            }
            // \u05E2\u05D3\u05DB\u05DF \u05E1\u05D8\u05D8\u05D5\u05E1 UI (\u05E9\u05D5\u05E8\u05EA \u05E1\u05D8\u05D8\u05D5\u05E1)
            const statusEl = document.getElementById('status');
            if (statusEl) statusEl.innerText = `\u05D6\u05DE\u05DF \u05E0\u05D2\u05DE\u05E8 \u2014 ${winner} \u05E0\u05D9\u05E6\u05D7`;
            if (typeof window.autoSaveFinishedGame === 'function') window.autoSaveFinishedGame();
        } catch (err) {
            console.error('onFlag handler error', err);
        }
    };


    // update toggle button text / hide form
    document.getElementById('clock-form').style.display = 'none';
    document.getElementById('toggleClockBtn').innerText = '\u05D4\u05E1\u05E8 \u05E9\u05E2\u05D5\u05DF';

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
    document.getElementById('toggleClockBtn').innerText = '\u05D4\u05D5\u05E1\u05E3 \u05E9\u05E2\u05D5\u05DF';
    document.getElementById('clock-form').style.display = 'none';
}

/* ---------- Move list rendering helpers ---------- */

// \u05D4\u05DE\u05E8\u05EA \u05E7\u05D5\u05D0\u05D5\u05E8\u05D3\u05D9\u05E0\u05D8\u05D5\u05EA engine (r,c) \u05DC\u05E9\u05DD \u05DE\u05E9\u05D1\u05E6\u05EA \u05D1\u05E9\u05D9\u05D8\u05D4 \u05D4\u05D0\u05DC\u05D2\u05D1\u05E8\u05D9\u05EA: a1..h8
function squareName(r, c) {
    const file = String.fromCharCode(97 + c); // 0->'a'
    const rank = 8 - r; // r=0 -> '8'
    return `${file}${rank}`;
}

// \u05DE\u05E7\u05D1\u05DC entry \u05DE\u05D4\u05BEmoveHistory (\u05D4\u05DE\u05D1\u05E0\u05D4 \u05E9\u05D0\u05EA\u05D4 \u05E9\u05D5\u05DE\u05E8 \u05D1-history) \u05D5\u05DE\u05D7\u05D6\u05D9\u05E8 \u05DE\u05D7\u05E8\u05D5\u05D6\u05EA \u05E7\u05E8\u05D9\u05D0\u05D4
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

    // \u05D0\u05DD \u05D9\u05E9 \u05DE\u05E1\u05E4\u05E8 \u05D0\u05D9-\u05D6\u05D5\u05D2\u05D9 \u05E9\u05DC \u05DE\u05D4\u05DC\u05DB\u05D9\u05DD (\u05DE\u05D4\u05DC\u05DA \u05DC\u05D1\u05DF \u05D0\u05D7\u05E8\u05D5\u05DF) - \u05D0\u05E4\u05E9\u05E8 \u05DC\u05D2\u05DC\u05D5\u05DC \u05DC\u05DE\u05D8\u05D4 \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA
    container.scrollTop = container.scrollHeight;
}

// initial state: ensure no clock rendering
ensureClocksRendering();


// \u05D7\u05D9\u05D1\u05D5\u05E8 \u05D1\u05D8\u05D5\u05D7 \u05E9\u05DC \u05DB\u05E4\u05EA\u05D5\u05E8\u05D9 \u05D4\u05DE\u05DE\u05E9\u05E7
window.addEventListener('DOMContentLoaded', () => {
    const modalResetBtn = document.getElementById('modalResetBtn');
    if (modalResetBtn) modalResetBtn.addEventListener('click', window.game.reset);

    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) resetBtn.addEventListener('click', window.game.reset);

    const flipBtn = document.getElementById('flipBtn');
    if (flipBtn) flipBtn.addEventListener('click', window.game.flipBoard);

    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.addEventListener('click', window.game.undo);

    const redoBtn = document.getElementById('redoBtn');
    if (redoBtn) redoBtn.addEventListener('click', window.game.redo);

    const toggleAiBtn = document.getElementById('toggleAiBtn');
    if (toggleAiBtn) toggleAiBtn.addEventListener('click', window.game.toggleAI);

    const depthInput = document.getElementById('aiDepthInput');
    if (depthInput) {
        depthInput.addEventListener('change', () => {
            const depth = Math.max(1, Math.min(6, parseInt(depthInput.value, 10) || 3));
            depthInput.value = String(depth);
            aiPlayer.setDepth(depth);
        });
    }

    const chk = document.getElementById('allowPreviewUndoCheckbox');
    if (chk) {
        chk.checked = !!ui.allowUndoWhilePreview;
        chk.addEventListener('change', () => {
            ui.allowUndoWhilePreview = chk.checked;
            ui.updateControlStates();
        });
    }

    document.addEventListener('keydown', (e) => {
        const target = e.target;
        if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            window.game.undo();
        } else if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
                   ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
            e.preventDefault();
            window.game.redo();
        }
    });
});

// \u05D9\u05E6\u05D9\u05E8\u05EA \u05DB\u05E4\u05EA\u05D5\u05E8 Live \u05DE\u05E2\u05DC \u05D4\u05DE\u05D4\u05DC\u05DB\u05D9\u05DD \u05D1\u05E6\u05D3 \u05E9\u05DE\u05D0\u05DC
(function () {
    const movesHeader = document.querySelector('.moves-panel-header h3');
    if (!movesHeader) return;

    // \u05D1\u05D3\u05D9\u05E7\u05D4 \u05D0\u05DD \u05D4\u05DB\u05E4\u05EA\u05D5\u05E8 \u05DB\u05D1\u05E8 \u05E7\u05D9\u05D9\u05DD
    let liveBtn = document.getElementById('moves-live-btn');
    if (!liveBtn) {
        liveBtn = document.createElement('button');
        liveBtn.id = 'moves-live-btn';
        liveBtn.textContent = 'Live';
        liveBtn.className = 'btn'; // \u05EA\u05EA\u05D0\u05DD \u05D0\u05EA \u05D4\u05E1\u05D2\u05E0\u05D5\u05DF \u05E9\u05DC\u05DA
        liveBtn.style.display = 'none'; // \u05E0\u05E1\u05EA\u05E8 \u05DB\u05D1\u05E8\u05D9\u05E8\u05EA \u05DE\u05D7\u05D3\u05DC
        liveBtn.style.marginLeft = '10px'; // \u05E8\u05D5\u05D5\u05D7 \u05DE\u05D4\u05DB\u05D5\u05EA\u05E8\u05EA
        liveBtn.style.verticalAlign = 'middle';

        // \u05DE\u05DB\u05E0\u05D9\u05E1\u05D9\u05DD \u05D0\u05EA \u05D4\u05DB\u05E4\u05EA\u05D5\u05E8 \u05D0\u05D7\u05E8\u05D9 \u05D4\u05DB\u05D5\u05EA\u05E8\u05EA \u05D1\u05EA\u05D5\u05DA \u05D4\u05BEheader
        movesHeader.parentNode.insertBefore(liveBtn, movesHeader.nextSibling);

        // \u05DC\u05D7\u05D9\u05E6\u05D4 \u05E2\u05DC \u05D4\u05DB\u05E4\u05EA\u05D5\u05E8 \u05D9\u05D5\u05E6\u05D0\u05EA \u05DE\u05DE\u05E6\u05D1 Preview
        liveBtn.addEventListener('click', () => {
            if (ui && ui.exitPreview) ui.exitPreview();
        });
    }

    // \u05E2\u05D3\u05DB\u05D5\u05DF \u05D4\u05EA\u05E6\u05D5\u05D2\u05D4 \u05D1\u05D4\u05EA\u05D0\u05DD \u05DC\u05E4\u05E8\u05D9\u05D5\u05D5\u05D9\u05D5
    if (ui && ui.updateControlStates) ui.updateControlStates();
})();
