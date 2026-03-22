namespace TelegramMonitor;

[ApiDescriptionSettings(Name = "auth", Tag = "auth", Description = "认证与用户管理")]
public sealed class UserAccountService : IDynamicApiController, ITransient
{
    private readonly AuthService _authService;
    private readonly ICurrentUserAccessor _currentUser;

    public UserAccountService(AuthService authService, ICurrentUserAccessor currentUser)
    {
        _authService = authService;
        _currentUser = currentUser;
    }

    [HttpPost("login")]
    public async Task<LoginResponse> Login([FromBody] UserLoginRequest request)
    {
        var result = await _authService.LoginAsync(request.UserName, request.Password);
        return new LoginResponse(result.Token, result.User);
    }

    [HttpGet("me")]
    public CurrentUserInfo Me()
    {
        if (!_currentUser.IsAuthenticated)
            throw Oops.Oh("请先登录");

        return _currentUser.User!;
    }

    [HttpPost("change-password")]
    public async Task ChangePassword([FromBody] ChangePasswordRequest request)
    {
        if (!_currentUser.IsAuthenticated)
            throw Oops.Oh("请先登录");

        await _authService.ChangePasswordAsync(_currentUser.UserId, request.CurrentPassword, request.NewPassword);
    }

    [HttpGet("users")]
    public async Task<List<UserAccountDto>> Users()
    {
        EnsureAdmin();
        var users = await _authService.GetUsersAsync();
        return users.Select(x => new UserAccountDto(
            x.Id,
            x.UserName,
            x.Role,
            x.ExpiresAtUtc,
            x.IsEnabled,
            x.CreatedAtUtc)).ToList();
    }

    [HttpPost("users")]
    public async Task<UserAccountDto> CreateUser([FromBody] CreateUserRequest request)
    {
        EnsureAdmin();
        var user = await _authService.CreateUserAsync(
            request.UserName,
            request.Password,
            request.ExpiresAtUtc,
            request.Role);
        return new UserAccountDto(user.Id, user.UserName, user.Role, user.ExpiresAtUtc, user.IsEnabled, user.CreatedAtUtc);
    }

    [HttpPut("users")]
    public async Task UpdateUser([FromBody] UpdateUserRequest request)
    {
        EnsureAdmin();
        await _authService.UpdateUserAsync(
            request.Id,
            request.ExpiresAtUtc,
            request.IsEnabled,
            request.Role,
            request.NewPassword);
    }

    [HttpPost("users/delete")]
    public async Task DeleteUser([FromBody] DeleteUserRequest request)
    {
        EnsureAdmin();
        await _authService.DeleteUserAsync(_currentUser.UserId, request.Id);
    }

    private void EnsureAdmin()
    {
        if (!_currentUser.IsAdmin)
            throw Oops.Oh("仅管理员可操作");
    }
}

public sealed record UserLoginRequest(string UserName, string Password);
public sealed record LoginResponse(string Token, CurrentUserInfo User);
public sealed record UserAccountDto(
    int Id,
    string UserName,
    UserRole Role,
    DateTime? ExpiresAtUtc,
    bool IsEnabled,
    DateTime CreatedAtUtc);
public sealed record CreateUserRequest(
    string UserName,
    string Password,
    DateTime? ExpiresAtUtc,
    UserRole Role);
public sealed record UpdateUserRequest(
    int Id,
    DateTime? ExpiresAtUtc,
    bool IsEnabled,
    UserRole Role,
    string? NewPassword);
public sealed record DeleteUserRequest(int Id);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
