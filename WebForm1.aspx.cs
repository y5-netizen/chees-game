using System;
using System.Collections.Generic;
using System.Data;
using System.Data.OleDb;
using System.Security.Cryptography;
using System.Text;
using System.Web;
using System.Web.Script.Services;
using System.Web.Services;
using System.Web.UI;

namespace the_aspx_file
{
    public partial class WebForm1 : Page
    {
        // ── Connection string (uses App_Data folder) ──────────────────────
        private static string ConnStr =>
            "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" +
            HttpContext.Current.Server.MapPath("~/App_Data/Database21.accdb") +
            ";Persist Security Info=False;";

        protected void Page_Load(object sender, EventArgs e)
        {
            InitializeDatabase();
        }

        private void InitializeDatabase()
        {
            try
            {
                using (var conn = OpenConn())
                {
                    // יצירת טבלת Users אם לא קיימת
                    var cmd1 = new OleDbCommand(@"
                CREATE TABLE IF NOT EXISTS Users (
                    UserID AUTOINCREMENT PRIMARY KEY,
                    Username TEXT(50) NOT NULL,
                    Password TEXT(255) NOT NULL,
                    Email TEXT(100),
                    IsAdmin YESNO DEFAULT FALSE,
                    CreatedAt DATETIME
                )", conn);

                    // יצירת טבלת Games אם לא קיימת  
                    var cmd2 = new OleDbCommand(@"
                CREATE TABLE IF NOT EXISTS Games (
                    GameID AUTOINCREMENT PRIMARY KEY,
                    UserID LONG,
                    Opponent TEXT(50),
                    Result TEXT(20),
                    Moves MEMO,
                    PlayedAt DATETIME
                )", conn);

                    try { cmd1.ExecuteNonQuery(); } catch { }
                    try { cmd2.ExecuteNonQuery(); } catch { }
                }
            }
            catch { }
        }

        // ══════════════════════════════════════════════════════════════════
        //  HELPERS
        // ══════════════════════════════════════════════════════════════════

        private static string HashPassword(string password)
        {
            using (var sha = SHA256.Create())
            {
                var bytes = Encoding.UTF8.GetBytes(password + "chess_salt_2024");
                return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLower();
            }
        }

        private static OleDbConnection OpenConn()
        {
            var conn = new OleDbConnection(ConnStr);
            conn.Open();
            return conn;
        }

        // ══════════════════════════════════════════════════════════════════
        //  REGISTER
        // ══════════════════════════════════════════════════════════════════
        [WebMethod(EnableSession = true)]
        [ScriptMethod(ResponseFormat = ResponseFormat.Json)]
        public static object Register(string username, string email, string password)
        {
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
                return new { success = false, message = "שם משתמש וסיסמה הם שדות חובה" };

            if (username.Length < 3)
                return new { success = false, message = "שם משתמש חייב להכיל לפחות 3 תווים" };

            try
            {
                using (var conn = OpenConn())
                {
                    // Check if username already exists
                    var checkCmd = new OleDbCommand(
                        "SELECT COUNT(*) FROM Users WHERE Username = ?", conn);
                    checkCmd.Parameters.AddWithValue("?", username);
                    int count = (int)checkCmd.ExecuteScalar();
                    if (count > 0)
                        return new { success = false, message = "שם המשתמש כבר קיים" };

                    // Insert new user
                    var insertCmd = new OleDbCommand(
                        "INSERT INTO Users (Username, Email, Password, IsAdmin, CreatedAt) VALUES (?, ?, ?, False, ?)",
                        conn);
                    insertCmd.Parameters.AddWithValue("?", username);
                    insertCmd.Parameters.AddWithValue("?", email ?? "");
                    insertCmd.Parameters.AddWithValue("?", HashPassword(password));
                    insertCmd.Parameters.AddWithValue("?", DateTime.Now);
                    insertCmd.ExecuteNonQuery();

                    return new { success = true, message = "נרשמת בהצלחה!" };
                }
            }
            catch (Exception ex)
            {
                return new { success = false, message = "שגיאה: " + ex.Message };
            }
        }

        // ══════════════════════════════════════════════════════════════════
        //  LOGIN
        // ══════════════════════════════════════════════════════════════════
        [WebMethod(EnableSession = true)]
        [ScriptMethod(ResponseFormat = ResponseFormat.Json)]
        public static object Login(string username, string password)
        {
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
                return new { success = false, message = "יש למלא שם משתמש וסיסמה" };

            try
            {
                using (var conn = OpenConn())
                {
                    var cmd = new OleDbCommand(
                        "SELECT UserID, Username, Email, IsAdmin FROM Users WHERE Username = ? AND Password = ?",
                        conn);
                    cmd.Parameters.AddWithValue("?", username);
                    cmd.Parameters.AddWithValue("?", HashPassword(password));

                    using (var reader = cmd.ExecuteReader())
                    {
                        if (!reader.Read())
                            return new { success = false, message = "שם משתמש או סיסמה שגויים" };

                        int userId   = (int)reader["UserID"];
                        string uname = reader["Username"].ToString();
                        bool isAdmin = reader["IsAdmin"] != DBNull.Value && (bool)reader["IsAdmin"];

                        // Save session
                        HttpContext.Current.Session["UserID"]   = userId;
                        HttpContext.Current.Session["Username"] = uname;
                        HttpContext.Current.Session["IsAdmin"]  = isAdmin;

                        return new
                        {
                            success = true,
                            user = new { userId, username = uname, isAdmin }
                        };
                    }
                }
            }
            catch (Exception ex)
            {
                return new { success = false, message = "שגיאה: " + ex.Message };
            }
        }

        // ══════════════════════════════════════════════════════════════════
        //  LOGOUT
        // ══════════════════════════════════════════════════════════════════
        [WebMethod(EnableSession = true)]
        [ScriptMethod(ResponseFormat = ResponseFormat.Json)]
        public static object Logout()
        {
            HttpContext.Current.Session.Clear();
            return new { success = true };
        }

        // ══════════════════════════════════════════════════════════════════
        //  SAVE GAME
        // ══════════════════════════════════════════════════════════════════
        [WebMethod(EnableSession = true)]
        [ScriptMethod(ResponseFormat = ResponseFormat.Json)]
        public static object SaveGame(int userId, string moves, string result, string opponent)
        {
            // Validate session
            var session = HttpContext.Current.Session;
            if (session["UserID"] == null || (int)session["UserID"] != userId)
                return new { success = false, message = "לא מחובר" };

            try
            {
                using (var conn = OpenConn())
                {
                    var cmd = new OleDbCommand(
                        "INSERT INTO Games (UserID, Opponent, Result, Moves, PlayedAt) VALUES (?, ?, ?, ?, ?)",
                        conn);
                    cmd.Parameters.AddWithValue("?", userId);
                    cmd.Parameters.AddWithValue("?", opponent ?? "שחקן");
                    cmd.Parameters.AddWithValue("?", result ?? "unknown");
                    cmd.Parameters.AddWithValue("?", moves ?? "");
                    cmd.Parameters.AddWithValue("?", DateTime.Now);
                    cmd.ExecuteNonQuery();

                    return new { success = true };
                }
            }
            catch (Exception ex)
            {
                return new { success = false, message = ex.Message };
            }
        }

        // ══════════════════════════════════════════════════════════════════
        //  GET MY GAMES (history)
        // ══════════════════════════════════════════════════════════════════
        [WebMethod(EnableSession = true)]
        [ScriptMethod(ResponseFormat = ResponseFormat.Json)]
        public static object GetMyGames(int userId)
        {
            var session = HttpContext.Current.Session;
            if (session["UserID"] == null || (int)session["UserID"] != userId)
                return new List<object>();

            var list = new List<object>();
            try
            {
                using (var conn = OpenConn())
                {
                    var cmd = new OleDbCommand(
                        "SELECT GameID, Opponent, Result, PlayedAt FROM Games WHERE UserID = ? ORDER BY PlayedAt DESC",
                        conn);
                    cmd.Parameters.AddWithValue("?", userId);

                    using (var r = cmd.ExecuteReader())
                    {
                        while (r.Read())
                        {
                            list.Add(new
                            {
                                gameId    = (int)r["GameID"],
                                opponent  = r["Opponent"].ToString(),
                                result    = r["Result"].ToString(),
                                playedAt  = Convert.ToDateTime(r["PlayedAt"]).ToString("dd/MM/yyyy HH:mm")
                            });
                        }
                    }
                }
            }
            catch { /* return empty list on error */ }
            return list;
        }

        // ══════════════════════════════════════════════════════════════════
        //  GET ALL USERS (admin only)
        // ══════════════════════════════════════════════════════════════════
        [WebMethod(EnableSession = true)]
        [ScriptMethod(ResponseFormat = ResponseFormat.Json)]
        public static object GetAllUsers()
        {
            var session = HttpContext.Current.Session;
            if (session["IsAdmin"] == null || !(bool)session["IsAdmin"])
                return new List<object>();

            var list = new List<object>();
            try
            {
                using (var conn = OpenConn())
                {
                    var cmd = new OleDbCommand(
                        "SELECT u.UserID, u.Username, u.Email, u.IsAdmin, u.CreatedAt, " +
                        "(SELECT COUNT(*) FROM Games g WHERE g.UserID = u.UserID) AS GameCount " +
                        "FROM Users u ORDER BY u.CreatedAt DESC",
                        conn);

                    using (var r = cmd.ExecuteReader())
                    {
                        while (r.Read())
                        {
                            list.Add(new
                            {
                                userId    = (int)r["UserID"],
                                username  = r["Username"].ToString(),
                                email     = r["Email"].ToString(),
                                isAdmin   = r["IsAdmin"] != DBNull.Value && (bool)r["IsAdmin"],
                                gameCount = r["GameCount"] != DBNull.Value ? Convert.ToInt32(r["GameCount"]) : 0,
                                createdAt = Convert.ToDateTime(r["CreatedAt"]).ToString("dd/MM/yyyy")
                            });
                        }
                    }
                }
            }
            catch { /* return empty list */ }
            return list;
        }
    }
}