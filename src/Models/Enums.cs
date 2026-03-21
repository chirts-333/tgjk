namespace TelegramMonitor;

public enum LoginState
{
    // 登录流程状态机。
    [Description("未登录")]
    NotLoggedIn = 0,

    [Description("等待验证码")]
    WaitingForVerificationCode = 1,

    [Description("等待密码")]
    WaitingForPassword = 2,

    [Description("等待姓名")]
    WaitingForName = 3,

    [Description("已登录")]
    LoggedIn = 4,

    [Description("其他")]
    Other = 5
}

public enum ProxyType
{
    // 代理模式配置。
    [Description("跟随系统代理")]
    None = 0,

    [Description("SOCKS5")]
    Socks5 = 1,

    [Description("MTProxy")]
    MTProxy = 2
}

public enum MonitorStartResult
{
    // 监控启动结果。
    [Description("启动成功")]
    Started = 0,

    [Description("未设置目标群")]
    MissingTarget = 1,

    [Description("未获取到用户信息")]
    NoUserInfo = 2,

    [Description("已在运行")]
    AlreadyRunning = 3,

    [Description("未登录")]
    Error = 4
}

public enum GroupMessageTaskStartResult
{
    [Description("启动成功")]
    Started = 0,

    [Description("已在运行")]
    AlreadyRunning = 1,

    [Description("未登录")]
    NotLoggedIn = 2,

    [Description("未配置目标群组")]
    MissingTargets = 3,

    [Description("未配置发送模板")]
    MissingTemplates = 4,

    [Description("配置无效")]
    InvalidConfig = 5,

    [Description("启动失败")]
    Error = 6
}
