<%@ Page Language="C#" AutoEventWireup="true" CodeBehind="WebForm1.aspx.cs" Inherits="the_aspx_file.WebForm1" %>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="he" dir="rtl">
<head runat="server">
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>מנוע שחמט</title>
    <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
    <link rel="stylesheet" href="style.css" />
    <style>
        /* ── Auth overlay ── */
        #auth-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.85);
            display: flex; justify-content: center; align-items: center;
            z-index: 9999;
        }
        #auth-box {
            background: #262421; border-radius: 12px;
            padding: 36px 40px; width: 340px;
            border: 1px solid #444; color: #fff;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            direction: rtl;
        }
        #auth-box h2 { text-align:center; margin-bottom:20px; font-size:1.4rem; }
        #auth-box input {
            width:100%; box-sizing:border-box;
            padding:10px; margin-bottom:12px;
            background:#1a1917; border:1px solid #555;
            border-radius:6px; color:#fff; font-size:1rem;
        }
        #auth-box button {
            width:100%; padding:11px;
            margin-bottom:8px; font-size:1rem;
        }
        #auth-tabs { display:flex; margin-bottom:20px; border-bottom:1px solid #444; }
        .auth-tab {
            flex:1; padding:8px; text-align:center; cursor:pointer;
            color:#aaa; font-weight:bold; border-bottom:3px solid transparent;
        }
        .auth-tab.active { color:#81b64c; border-bottom:3px solid #81b64c; }
        #auth-error { color:#e74c3c; font-size:13px; text-align:center; min-height:18px; }
        #auth-success { color:#81b64c; font-size:13px; text-align:center; min-height:18px; }

        /* ── Top bar ── */
        #topbar {
            position:fixed; top:0; left:0; right:0; height:44px;
            background:#1a1917; display:flex; align-items:center;
            justify-content:space-between; padding:0 16px;
            z-index:500; border-bottom:1px solid #333; direction:rtl;
        }
        #topbar .tb-left { display:flex; align-items:center; gap:12px; }
        #topbar .tb-right { display:flex; align-items:center; gap:10px; }
        #topbar span { color:#ccc; font-size:14px; }
        #topbar button {
            padding:5px 12px; font-size:13px; margin:0;
        }
        body { padding-top: 44px; }

        /* ── History modal ── */
        #history-modal {
            position:fixed; inset:0; background:rgba(0,0,0,0.75);
            display:none; justify-content:center; align-items:center; z-index:600;
        }
        #history-box {
            background:#262421; border-radius:10px; padding:28px 32px;
            width:520px; max-height:70vh; overflow-y:auto;
            border:1px solid #444; color:#fff; direction:rtl;
        }
        #history-box h3 { margin-bottom:16px; }
        .game-row {
            background:#1e1c1a; border-radius:6px; padding:10px 14px;
            margin-bottom:8px; font-size:13px; display:flex;
            justify-content:space-between; align-items:center;
        }
        .game-row .gr-info { color:#ccc; }
        .game-row .gr-result { font-weight:bold; color:#81b64c; }
        .gr-result.loss { color:#e74c3c; }
        .gr-result.draw { color:#f0ad4e; }

        /* ── Admin modal ── */
        #admin-modal {
            position:fixed; inset:0; background:rgba(0,0,0,0.75);
            display:none; justify-content:center; align-items:center; z-index:600;
        }
        #admin-box {
            background:#262421; border-radius:10px; padding:28px 32px;
            width:560px; max-height:70vh; overflow-y:auto;
            border:1px solid #444; color:#fff; direction:rtl;
        }
        #admin-box h3 { margin-bottom:16px; }
        .user-row {
            background:#1e1c1a; border-radius:6px; padding:9px 14px;
            margin-bottom:7px; font-size:13px;
            display:flex; justify-content:space-between;
        }
        .user-row span { color:#ccc; }
        .badge-admin { background:#81b64c; color:#fff; border-radius:4px; padding:2px 7px; font-size:11px; }

        /* ── Save toast ── */
        #save-toast {
            position:fixed; bottom:70px; right:20px;
            background:#81b64c; color:#fff; padding:10px 18px;
            border-radius:8px; font-size:14px; display:none;
            z-index:700; box-shadow:0 4px 12px rgba(0,0,0,0.4);
        }

        .modal-close-btn {
            float:left; background:#454341; padding:6px 14px;
            border-radius:6px; cursor:pointer; font-size:13px;
            border:none; color:#fff;
        }
    </style>
</head>
<body>

<!-- ══════════════════════════════════════════════════════
     AUTH OVERLAY (hidden when logged in)
════════════════════════════════════════════════════════ -->
<div id="auth-overlay">
    <div id="auth-box">
        <h2>♟ שחמט</h2>
        <div id="auth-tabs">
            <div class="auth-tab active" onclick="switchTab('login')">התחברות</div>
            <div class="auth-tab" onclick="switchTab('register')">הרשמה</div>
        </div>

        <!-- Login form -->
        <div id="login-form">
            <input type="text" id="login-user" placeholder="שם משתמש" />
            <input type="password" id="login-pass" placeholder="סיסמה" />
            <button onclick="doLogin()">התחבר</button>
        </div>

        <!-- Register form -->
        <div id="register-form" style="display:none;">
            <input type="text" id="reg-user" placeholder="שם משתמש" />
            <input type="email" id="reg-email" placeholder="אימייל (אופציונלי)" />
            <input type="password" id="reg-pass" placeholder="סיסמה" />
            <input type="password" id="reg-pass2" placeholder="אימות סיסמה" />
            <button onclick="doRegister()">הירשם</button>
        </div>

        <div id="auth-error"></div>
        <div id="auth-success"></div>
    </div>
</div>

<!-- ══════════════════════════════════════════════════════
     TOP BAR
════════════════════════════════════════════════════════ -->
<div id="topbar">
    <div class="tb-right">
        <span>♟ שחמט</span>
        <span id="tb-welcome" style="color:#81b64c;font-weight:bold;"></span>
    </div>
    <div class="tb-left">
        <button onclick="doSaveGame()">💾 שמור משחק</button>
        <button onclick="showHistory()">📋 היסטוריה</button>
        <button id="admin-btn" onclick="showAdmin()" style="display:none;background:#8e44ad;">👑 מנהל</button>
        <button onclick="doLogout()" style="background:#c0392b;">יציאה</button>
    </div>
</div>

<!-- ══════════════════════════════════════════════════════
     CHESS GAME (copied from index.html, minus <head> and <script> tags)
════════════════════════════════════════════════════════ -->
<div class="main-container">
    <div class="sidebar">
        <h2>לוח הבקרה</h2>
        <div class="status-box" id="status">תור: <span id="turn-text">לבן</span></div>

        <div class="captured">
            <div id="captured-w"></div>
            <div id="captured-b"></div>
        </div>

        <div class="controls">
            <div id="clocks-wrapper">
                <div id="clocks" class="no-clock"></div>
                <div id="clock-controls">
                    <button id="toggleClockBtn">הוסף שעון</button>
                    <div id="clock-form" style="display:none;">
                        <div class="form-row">
                            <label>לבן (דקות): <input id="whiteMinutesInput" type="number" min="0" value="5" /></label>
                        </div>
                        <div class="form-row">
                            <label>שחור (דקות): <input id="blackMinutesInput" type="number" min="0" value="5" /></label>
                        </div>
                        <div class="form-row">
                            <label>הוספה לכל מהלך (שניות): <input id="incrementInput" type="number" min="0" value="0" /></label>
                        </div>
                        <div class="form-row">
                            <button id="startClockBtn">הפעל שעון (תתחיל בעוד ~2s)</button>
                            <button id="cancelClockBtn">בטל</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="game-buttons">
                <button id="resetBtn">משחק חדש</button>
                <button id="flipBtn">הפוך לוח</button>
                <button id="undoBtn" title="Undo (Ctrl+Z)">⟲ ביטול</button>
                <button id="redoBtn" title="Redo (Ctrl+Y / Ctrl+Shift+Z)">⟳ החזר</button>
                <button id="toggleAiBtn">מצב נגד מחשב: <span id="ai-status">כבוי</span></button>
                <div id="ai-controls" class="ai-controls" style="display:none;">
                    <label>עומק AI:
                        <input id="aiDepthInput" type="number" min="1" max="6" value="3" style="width:48px;" />
                    </label>
                </div>
            </div>
        </div>

        <p class="debug-info">הערכת מצב ללבן: <span id="eval-score">0</span></p>
    </div>

    <div class="board-wrapper">
        <div id="board" class="board"></div>
    </div>
</div>

<div id="moves-panel" class="moves-panel">
    <div class="moves-panel-header">
        <h3>מהלכים</h3>
    </div>
    <div id="move-list" class="move-list"></div>
</div>

<div id="game-over-modal" class="modal-overlay">
    <div class="modal-content">
        <div class="modal-title" id="winner-title">הלבן ניצח!</div>
        <div class="modal-text" id="end-reason">על ידי מט</div>
        <button onclick="game.reset()">משחק חדש</button>
        <button class="close-btn" onclick="document.getElementById('game-over-modal').style.display='none'">סגור</button>
    </div>
</div>

<!-- ══════════════════════════════════════════════════════
     HISTORY MODAL
════════════════════════════════════════════════════════ -->
<div id="history-modal">
    <div id="history-box">
        <button class="modal-close-btn" onclick="document.getElementById('history-modal').style.display='none'">✕ סגור</button>
        <h3>📋 היסטוריית משחקים</h3>
        <div id="history-list">טוען...</div>
    </div>
</div>

<!-- ══════════════════════════════════════════════════════
     ADMIN MODAL
════════════════════════════════════════════════════════ -->
<div id="admin-modal">
    <div id="admin-box">
        <button class="modal-close-btn" onclick="document.getElementById('admin-modal').style.display='none'">✕ סגור</button>
        <h3>👑 ניהול משתמשים</h3>
        <div id="admin-user-list">טוען...</div>
    </div>
</div>

<!-- Save toast -->
<div id="save-toast">✅ המשחק נשמר בהצלחה!</div>

<!-- ══════════════════════════════════════════════════════
     SCRIPTS
════════════════════════════════════════════════════════ -->
<script src="ai.js"></script>
<script src="script.js"></script>
<script src="multiplayer.js"></script>

<script>
    // ── State ───────────────────────────────────────────
    var currentUser = null; // { userId, username, isAdmin }

    // ── Tab switching ────────────────────────────────────
    function switchTab(tab) {
        document.getElementById('login-form').style.display    = tab === 'login'    ? 'block' : 'none';
        document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
        document.querySelectorAll('.auth-tab').forEach(function(t, i) {
            t.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1));
        });
        clearAuthMsg();
    }

    function setAuthError(msg)   { document.getElementById('auth-error').textContent   = msg; document.getElementById('auth-success').textContent = ''; }
    function setAuthSuccess(msg) { document.getElementById('auth-success').textContent = msg; document.getElementById('auth-error').textContent   = ''; }
    function clearAuthMsg()      { document.getElementById('auth-error').textContent = ''; document.getElementById('auth-success').textContent = ''; }

    // ── Login ────────────────────────────────────────────
    function doLogin() {
        var u = document.getElementById('login-user').value.trim();
        var p = document.getElementById('login-pass').value;
        if (!u || !p) { setAuthError('יש למלא שם משתמש וסיסמה'); return; }

        $.ajax({
            type: 'POST', url: 'WebForm1.aspx/Login',
            data: JSON.stringify({ username: u, password: p }),
            contentType: 'application/json; charset=utf-8',
            dataType: 'json',
            success: function(r) {
                var res = r.d;
                if (res.success) {
                    currentUser = res.user;
                    onLoggedIn();
                } else {
                    setAuthError(res.message);
                }
            },
            error: function() { setAuthError('שגיאת שרת'); }
        });
    }

    // ── Register ─────────────────────────────────────────
    function doRegister() {
        var u  = document.getElementById('reg-user').value.trim();
        var e  = document.getElementById('reg-email').value.trim();
        var p  = document.getElementById('reg-pass').value;
        var p2 = document.getElementById('reg-pass2').value;
        if (!u || !p) { setAuthError('יש למלא שם משתמש וסיסמה'); return; }
        if (p !== p2) { setAuthError('הסיסמאות אינן תואמות'); return; }
        if (p.length < 4) { setAuthError('סיסמה חייבת להכיל לפחות 4 תווים'); return; }

        $.ajax({
            type: 'POST', url: 'WebForm1.aspx/Register',
            data: JSON.stringify({ username: u, email: e, password: p }),
            contentType: 'application/json; charset=utf-8',
            dataType: 'json',
            success: function(r) {
                var res = r.d;
                if (res.success) {
                    setAuthSuccess('נרשמת בהצלחה! מתחבר...');
                    setTimeout(function() { switchTab('login'); document.getElementById('login-user').value = u; }, 800);
                } else {
                    setAuthError(res.message);
                }
            },
            error: function() { setAuthError('שגיאת שרת'); }
        });
    }

    // ── After successful login ────────────────────────────
    function onLoggedIn() {
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('tb-welcome').textContent = 'שלום, ' + currentUser.username;
        if (currentUser.isAdmin) {
            document.getElementById('admin-btn').style.display = 'inline-block';
        }
    }

    // ── Logout ───────────────────────────────────────────
    function doLogout() {
        $.ajax({
            type: 'POST', url: 'WebForm1.aspx/Logout',
            data: '{}',
            contentType: 'application/json; charset=utf-8',
            dataType: 'json',
            complete: function() {
                currentUser = null;
                document.getElementById('auth-overlay').style.display = 'flex';
                document.getElementById('tb-welcome').textContent = '';
                document.getElementById('admin-btn').style.display = 'none';
            }
        });
    }

    // ── Save game ────────────────────────────────────────
    function doSaveGame() {
        if (!currentUser) { alert('יש להתחבר תחילה'); return; }

        // collect moves from engine history
        var moves = [];
        if (typeof engine !== 'undefined' && engine.moveHistory) {
            engine.moveHistory.forEach(function(m) {
                moves.push(m.san || (String.fromCharCode(97 + m.from.c) + (8 - m.from.r) + String.fromCharCode(97 + m.to.c) + (8 - m.to.r)));
            });
        }

        var result = 'ongoing';
        if (typeof engine !== 'undefined' && engine.isGameOver) result = engine.gameResult || 'unknown';

        $.ajax({
            type: 'POST', url: 'WebForm1.aspx/SaveGame',
            data: JSON.stringify({
                userId: currentUser.userId,
                moves: moves.join(' '),
                result: result,
                opponent: (typeof aiEnabled !== 'undefined' && aiEnabled) ? 'מחשב' : 'שחקן'
            }),
            contentType: 'application/json; charset=utf-8',
            dataType: 'json',
            success: function(r) {
                if (r.d && r.d.success) showToast();
                else alert('שגיאה בשמירה: ' + (r.d ? r.d.message : ''));
            },
            error: function() { alert('שגיאת שרת בשמירה'); }
        });
    }

    function showToast() {
        var t = document.getElementById('save-toast');
        t.style.display = 'block';
        setTimeout(function() { t.style.display = 'none'; }, 2500);
    }

    // ── History ──────────────────────────────────────────
    function showHistory() {
        if (!currentUser) { alert('יש להתחבר תחילה'); return; }
        document.getElementById('history-modal').style.display = 'flex';
        document.getElementById('history-list').innerHTML = 'טוען...';

        $.ajax({
            type: 'POST', url: 'WebForm1.aspx/GetMyGames',
            data: JSON.stringify({ userId: currentUser.userId }),
            contentType: 'application/json; charset=utf-8',
            dataType: 'json',
            success: function(r) {
                var games = r.d;
                if (!games || games.length === 0) {
                    document.getElementById('history-list').innerHTML = '<p style="color:#aaa">אין משחקים שמורים עדיין.</p>';
                    return;
                }
                var html = '';
                games.forEach(function(g) {
                    var cls = g.result === 'white' || g.result === 'black' ? '' : (g.result === 'draw' ? 'draw' : '');
                    html += '<div class="game-row">' +
                        '<div class="gr-info">🆚 ' + (g.opponent || '?') + '<br/><small>' + g.playedAt + '</small></div>' +
                        '<div class="gr-result ' + cls + '">' + formatResult(g.result) + '</div>' +
                        '</div>';
                });
                document.getElementById('history-list').innerHTML = html;
            },
            error: function() { document.getElementById('history-list').innerHTML = '<p style="color:red">שגיאת טעינה</p>'; }
        });
    }

    function formatResult(r) {
        if (!r) return '?';
        if (r === 'draw') return 'תיקו';
        if (r === 'white') return 'לבן ניצח';
        if (r === 'black') return 'שחור ניצח';
        if (r === 'ongoing') return 'בתהליך';
        return r;
    }

    // ── Admin ────────────────────────────────────────────
    function showAdmin() {
        document.getElementById('admin-modal').style.display = 'flex';
        document.getElementById('admin-user-list').innerHTML = 'טוען...';

        $.ajax({
            type: 'POST', url: 'WebForm1.aspx/GetAllUsers',
            data: '{}',
            contentType: 'application/json; charset=utf-8',
            dataType: 'json',
            success: function(r) {
                var users = r.d;
                if (!users || users.length === 0) {
                    document.getElementById('admin-user-list').innerHTML = '<p style="color:#aaa">אין משתמשים.</p>';
                    return;
                }
                var html = '';
                users.forEach(function(u) {
                    html += '<div class="user-row">' +
                        '<span>' + u.username + ' &nbsp; <small style="color:#777">' + (u.email || '') + '</small></span>' +
                        '<span>' + (u.isAdmin ? '<span class="badge-admin">מנהל</span>' : '') +
                        ' &nbsp; ' + u.gameCount + ' משחקים &nbsp; <small>' + u.createdAt + '</small></span>' +
                        '</div>';
                });
                document.getElementById('admin-user-list').innerHTML = html;
            },
            error: function() { document.getElementById('admin-user-list').innerHTML = '<p style="color:red">שגיאת טעינה</p>'; }
        });
    }

    // ── Enter key support ────────────────────────────────
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            if (document.getElementById('login-form').style.display !== 'none') doLogin();
            else doRegister();
        }
    });
</script>

</body>
</html>
