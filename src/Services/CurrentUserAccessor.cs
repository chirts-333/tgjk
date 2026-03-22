namespace TelegramMonitor;

public interface ICurrentUserAccessor
{
    CurrentUserInfo? User { get; }
    int UserId { get; }
    bool IsAuthenticated { get; }
    bool IsAdmin { get; }
}

public sealed class CurrentUserAccessor : ICurrentUserAccessor, IScoped
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public CurrentUserAccessor(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public CurrentUserInfo? User => _httpContextAccessor.HttpContext?.Items["CurrentUser"] as CurrentUserInfo;

    public int UserId => User?.Id ?? 0;

    public bool IsAuthenticated => UserId > 0;

    public bool IsAdmin => User?.Role == UserRole.Admin;
}
