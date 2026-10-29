# 本机运行环境安装记录

日期：2026-10-22。

- WSL 3.0.3.0：D:\tools\WSL，Microsoft 有效签名，MSI 返回 0。
- Docker Desktop 4.96.2 / Engine 29.9.2：D:\tools\Docker，Docker Inc 有效签名，安装返回 0。
- Docker WSL 数据目录：D:\tools\DockerData，实际 VHDX 已确认位于此处。
- kind 0.33.0、kubectl 1.37.1：D:\tools\bin，官方 SHA256 校验通过。
- 本轮安装无需重启。Docker daemon 已响应，docker-desktop 运行在 WSL 2。
- Docker 欢迎页面可 Skip，WSL 欢迎页面可关闭。当前本机开发不需要 Docker 账号。

第一次安装尝试因数据目录放在 Docker 程序目录内被安装器拒绝；改为独立 DockerData 目录后成功。没有关闭 TLS 校验，也没有清理原始业务数据。

安装日志在 D:\tools\setup-logs；安装程序保留在 D:\tools\installers。Windows 系统组件、快捷方式与用户配置仍由安装器存放在系统指定位置，并非整个 Windows 组件都可迁移到 D 盘。

新开的 PowerShell 可使用 Docker CLI；若当前终端 PATH 尚未刷新：

```powershell
$env:PATH='D:\tools\bin;D:\tools\Docker\resources\bin;'+$env:PATH
```

最终使用 GitHub.com 的 hrw8701-cyber 账号，经个人 fork 向团队仓库 muzi-haoming/ELEC5620-stage2 提交 PR #1。origin 指向团队仓库，personal 指向 fork。该账号只有团队读取权限，合并需有写权限的团队成员完成。学校 github.sydney.edu.au/hwan9982/ELEC5620-stage2 仅保留私有备份，其 PR 已关闭，后续不再向学校副本推送。
