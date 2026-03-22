using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TelegramMonitor;

public sealed class AuthService : ISingleton
{
    private const string DefaultAdminUserName = "admin";
    private const string DefaultAdminPassword = "admin123456";
    private const string TokenSecret = "TGJK_AUTH_TOKEN_SECRET_V1_20260322";

    private readonly ISqlSugarClient _db;

    public AuthService(ISqlSugarClient db)
    {
        _db = db;
    }

    public async Task EnsureAdminUserAsync()
    {
        var hasAdmin = await _db.Queryable<UserAccount>().AnyAsync(x => x.Role == UserRole.Admin);
        if (hasAdmin)
            return;

        var (hash, salt) = HashPassword(DefaultAdminPassword);
        await _db.Insertable(new UserAccount
        {
            UserName = DefaultAdminUserName,
            PasswordHash = hash,
            PasswordSalt = salt,
            Role = UserRole.Admin,
            IsEnabled = true,
            CreatedAtUtc = DateTime.UtcNow
        }).ExecuteCommandAsync();
    }

    public async Task<(string Token, CurrentUserInfo User)> LoginAsync(string userName, string password)
    {
        userName = (userName ?? string.Empty).Trim();
        password ??= string.Empty;

        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(password))
            throw Oops.Oh("用户名和密码不能为空");

        var user = await _db.Queryable<UserAccount>()
            .FirstAsync(x => x.UserName == userName);

        if (user == null)
            throw Oops.Oh("用户名或密码错误");

        if (!user.IsEnabled)
            throw Oops.Oh("账号已停用");

        if (user.ExpiresAtUtc.HasValue && user.ExpiresAtUtc.Value <= DateTime.UtcNow)
            throw Oops.Oh("账号已到期");

        if (!VerifyPassword(password, user.PasswordHash, user.PasswordSalt))
            throw Oops.Oh("用户名或密码错误");

        var currentUser = ToCurrentUser(user);
        var token = CreateToken(currentUser);
        return (token, currentUser);
    }

    public async Task<List<UserAccount>> GetUsersAsync()
    {
        return await _db.Queryable<UserAccount>().OrderBy(x => x.Id).ToListAsync();
    }

    public async Task<UserAccount> CreateUserAsync(
        string userName,
        string password,
        DateTime? expiresAtUtc,
        UserRole role)
    {
        userName = (userName ?? string.Empty).Trim();
        password ??= string.Empty;

        if (string.IsNullOrWhiteSpace(userName))
            throw Oops.Oh("用户名不能为空");
        if (string.IsNullOrWhiteSpace(password))
            throw Oops.Oh("密码不能为空");

        var exists = await _db.Queryable<UserAccount>().AnyAsync(x => x.UserName == userName);
        if (exists)
            throw Oops.Oh("用户名已存在");

        var (hash, salt) = HashPassword(password);
        var entity = new UserAccount
        {
            UserName = userName,
            PasswordHash = hash,
            PasswordSalt = salt,
            Role = role,
            ExpiresAtUtc = expiresAtUtc,
            IsEnabled = true,
            CreatedAtUtc = DateTime.UtcNow
        };

        entity.Id = await _db.Insertable(entity).ExecuteReturnIdentityAsync();
        return entity;
    }

    public async Task UpdateUserAsync(int id, DateTime? expiresAtUtc, bool isEnabled, UserRole role, string? newPassword)
    {
        var user = await _db.Queryable<UserAccount>().InSingleAsync(id);
        if (user == null)
            throw Oops.Oh("用户不存在");

        user.ExpiresAtUtc = expiresAtUtc;
        user.IsEnabled = isEnabled;
        user.Role = role;

        if (!string.IsNullOrWhiteSpace(newPassword))
        {
            var (hash, salt) = HashPassword(newPassword);
            user.PasswordHash = hash;
            user.PasswordSalt = salt;
        }

        await _db.Updateable(user).ExecuteCommandAsync();
    }

    public async Task DeleteUserAsync(int currentUserId, int targetUserId)
    {
        if (targetUserId <= 0)
            throw Oops.Oh("鐢ㄦ埛 ID 鏃犳晥");
        if (currentUserId == targetUserId)
            throw Oops.Oh("涓嶈兘鍒犻櫎褰撳墠鐧诲綍鐢ㄦ埛");

        var user = await _db.Queryable<UserAccount>().InSingleAsync(targetUserId);
        if (user == null)
            throw Oops.Oh("鐢ㄦ埛涓嶅瓨鍦?");

        if (user.Role == UserRole.Admin)
        {
            var adminCount = await _db.Queryable<UserAccount>().CountAsync(x => x.Role == UserRole.Admin);
            if (adminCount <= 1)
                throw Oops.Oh("鑷冲皯淇濈暀涓€涓鐞嗗憳");
        }

        await _db.Ado.BeginTranAsync();
        try
        {
            await _db.Deleteable<UserAccount>().In(targetUserId).ExecuteCommandAsync();
            await _db.Deleteable<KeywordConfig>().Where(x => x.UserId == targetUserId).ExecuteCommandAsync();
            await _db.Deleteable<UserTelegramSettings>().Where(x => x.UserId == targetUserId).ExecuteCommandAsync();
            await _db.Deleteable<MonitorReplyConfig>().Where(x => x.Id == targetUserId).ExecuteCommandAsync();
            await _db.Deleteable<GroupMessageTaskConfig>().Where(x => x.Id == targetUserId).ExecuteCommandAsync();
            await _db.Ado.CommitTranAsync();

            var userSessionDirectory = Path.Combine(TelegramMonitorConstants.SessionPath, targetUserId.ToString());
            if (Directory.Exists(userSessionDirectory))
                Directory.Delete(userSessionDirectory, true);
        }
        catch
        {
            await _db.Ado.RollbackTranAsync();
            throw;
        }
    }

    public async Task ChangePasswordAsync(int userId, string currentPassword, string newPassword)
    {
        currentPassword ??= string.Empty;
        newPassword ??= string.Empty;

        if (string.IsNullOrWhiteSpace(currentPassword))
            throw Oops.Oh("当前密码不能为空");
        if (string.IsNullOrWhiteSpace(newPassword))
            throw Oops.Oh("新密码不能为空");
        if (newPassword.Length < 6)
            throw Oops.Oh("新密码至少6位");

        var user = await _db.Queryable<UserAccount>().InSingleAsync(userId);
        if (user == null)
            throw Oops.Oh("用户不存在");

        if (!VerifyPassword(currentPassword, user.PasswordHash, user.PasswordSalt))
            throw Oops.Oh("当前密码错误");

        var (hash, salt) = HashPassword(newPassword);
        user.PasswordHash = hash;
        user.PasswordSalt = salt;
        await _db.Updateable(user).ExecuteCommandAsync();
    }

    public CurrentUserInfo? ParseToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token))
            return null;

        var parts = token.Split('.', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2)
            return null;

        var payloadBytes = FromBase64Url(parts[0]);
        var signatureBytes = FromBase64Url(parts[1]);
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(TokenSecret));
        var expectedSignature = hmac.ComputeHash(payloadBytes);
        if (!CryptographicOperations.FixedTimeEquals(signatureBytes, expectedSignature))
            return null;

        var payload = JsonSerializer.Deserialize<TokenPayload>(payloadBytes);
        if (payload == null || payload.ExpiresAtUtc <= DateTime.UtcNow)
            return null;

        return new CurrentUserInfo(payload.UserId, payload.UserName, payload.Role, payload.AccountExpiresAtUtc);
    }

    public static CurrentUserInfo ToCurrentUser(UserAccount user)
    {
        return new CurrentUserInfo(user.Id, user.UserName, user.Role, user.ExpiresAtUtc);
    }

    private static (string Hash, string Salt) HashPassword(string password)
    {
        var saltBytes = RandomNumberGenerator.GetBytes(16);
        var hashBytes = Rfc2898DeriveBytes.Pbkdf2(
            password,
            saltBytes,
            100_000,
            HashAlgorithmName.SHA256,
            32);
        return (Convert.ToBase64String(hashBytes), Convert.ToBase64String(saltBytes));
    }

    private static bool VerifyPassword(string password, string hash, string salt)
    {
        var hashBytes = Convert.FromBase64String(hash);
        var saltBytes = Convert.FromBase64String(salt);
        var computed = Rfc2898DeriveBytes.Pbkdf2(
            password,
            saltBytes,
            100_000,
            HashAlgorithmName.SHA256,
            32);
        return CryptographicOperations.FixedTimeEquals(hashBytes, computed);
    }

    private static string CreateToken(CurrentUserInfo user)
    {
        var payload = new TokenPayload
        {
            UserId = user.Id,
            UserName = user.UserName,
            Role = user.Role,
            AccountExpiresAtUtc = user.ExpiresAtUtc,
            ExpiresAtUtc = DateTime.UtcNow.AddDays(7)
        };

        var payloadBytes = JsonSerializer.SerializeToUtf8Bytes(payload);
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(TokenSecret));
        var signature = hmac.ComputeHash(payloadBytes);
        return $"{ToBase64Url(payloadBytes)}.{ToBase64Url(signature)}";
    }

    private static string ToBase64Url(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static byte[] FromBase64Url(string value)
    {
        var base64 = value.Replace('-', '+').Replace('_', '/');
        while (base64.Length % 4 != 0)
            base64 += "=";
        return Convert.FromBase64String(base64);
    }

    private sealed class TokenPayload
    {
        public int UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public UserRole Role { get; set; }
        public DateTime? AccountExpiresAtUtc { get; set; }
        public DateTime ExpiresAtUtc { get; set; }
    }
}
