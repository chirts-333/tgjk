namespace TelegramMonitor;

public sealed class AuthMiddleware : IMiddleware
{
    private readonly AuthService _authService;

    public AuthMiddleware(AuthService authService)
    {
        _authService = authService;
    }

    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        if (!context.Request.Path.StartsWithSegments("/api"))
        {
            await next(context);
            return;
        }

        if (context.Request.Path.StartsWithSegments("/api/auth/login"))
        {
            await next(context);
            return;
        }

        var token = ResolveToken(context.Request);
        var user = _authService.ParseToken(token);
        if (user == null)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new
            {
                succeeded = false,
                message = "请先登录"
            });
            return;
        }

        if (user.ExpiresAtUtc.HasValue && user.ExpiresAtUtc.Value <= DateTime.UtcNow)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new
            {
                succeeded = false,
                message = "账号已到期"
            });
            return;
        }

        context.Items["CurrentUser"] = user;
        await next(context);
    }

    private static string? ResolveToken(Microsoft.AspNetCore.Http.HttpRequest request)
    {
        var header = request.Headers.Authorization.ToString();
        if (!string.IsNullOrWhiteSpace(header) && header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return header["Bearer ".Length..].Trim();
        }

        return request.Query["token"].FirstOrDefault();
    }
}
