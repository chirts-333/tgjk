namespace TelegramMonitor;

[SugarTable("UserAccount")]
public class UserAccount
{
    [SugarColumn(IsPrimaryKey = true, IsIdentity = true)]
    public int Id { get; set; }

    [SugarColumn(Length = 64, IsNullable = false)]
    public string UserName { get; set; } = string.Empty;

    [SugarColumn(Length = 256, IsNullable = false)]
    public string PasswordHash { get; set; } = string.Empty;

    [SugarColumn(Length = 256, IsNullable = false)]
    public string PasswordSalt { get; set; } = string.Empty;

    [SugarColumn(IsNullable = false)]
    public UserRole Role { get; set; } = UserRole.User;

    [SugarColumn(IsNullable = true)]
    public DateTime? ExpiresAtUtc { get; set; }

    [SugarColumn(IsNullable = false)]
    public bool IsEnabled { get; set; } = true;

    [SugarColumn(IsNullable = false)]
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

public enum UserRole
{
    User = 0,
    Admin = 1
}

public sealed record CurrentUserInfo(
    int Id,
    string UserName,
    UserRole Role,
    DateTime? ExpiresAtUtc);
