import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  Lock,
  User,
  Eye,
  EyeOff,
  AlertCircle,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(username, password);
      navigate("/");
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch")) {
        setError("无法连接到服务器，请确认后端服务已启动");
      } else {
        setError(msg || "用户名或密码错误");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left Brand Panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
            <BarChart3 className="h-6 w-6" />
          </div>
          <span className="text-xl font-bold">业绩管理系统</span>
        </div>

        <div className="space-y-8">
          <h1 className="text-4xl font-bold leading-tight">
            全方位业绩管理
            <br />
            数据驱动决策
          </h1>
          <p className="text-lg text-blue-100">
            管理销售单位、人员、产品、成本与利润，实时掌握业务全貌。
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-white/10 p-5 backdrop-blur">
              <TrendingUp className="mb-3 h-7 w-7 text-blue-200" />
              <h3 className="text-sm font-semibold">实时数据看板</h3>
              <p className="mt-1 text-xs text-blue-100">业绩趋势一目了然</p>
            </div>
            <div className="rounded-xl bg-white/10 p-5 backdrop-blur">
              <Users className="mb-3 h-7 w-7 text-blue-200" />
              <h3 className="text-sm font-semibold">人员精细管理</h3>
              <p className="mt-1 text-xs text-blue-100">按单位管理人员绩效</p>
            </div>
            <div className="rounded-xl bg-white/10 p-5 backdrop-blur">
              <Wallet className="mb-3 h-7 w-7 text-blue-200" />
              <h3 className="text-sm font-semibold">动态成本评估</h3>
              <p className="mt-1 text-xs text-blue-100">灵活录入成本项目</p>
            </div>
            <div className="rounded-xl bg-white/10 p-5 backdrop-blur">
              <BarChart3 className="mb-3 h-7 w-7 text-blue-200" />
              <h3 className="text-sm font-semibold">收支利润观测</h3>
              <p className="mt-1 text-xs text-blue-100">利润分析实时呈现</p>
            </div>
          </div>
        </div>

        <p className="text-sm text-blue-200">© 2025 业绩管理系统 · All Rights Reserved</p>
      </div>

      {/* Right Login Form */}
      <div className="flex w-full items-center justify-center bg-muted/30 p-6 lg:w-1/2">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <BarChart3 className="h-6 w-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">业绩管理系统</span>
          </div>

          <div className="rounded-2xl border bg-card p-8 shadow-sm">
            <div className="mb-6 text-center">
              <h2 className="text-2xl font-bold">欢迎回来</h2>
              <p className="mt-1 text-sm text-muted-foreground">请登录您的账号以继续</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    placeholder="请输入用户名"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "登录中..." : "登 录"}
              </Button>
            </form>

            {/* Demo Accounts */}
            <div className="mt-6 border-t pt-4">
              <p className="mt-3 text-center text-xs text-muted-foreground">
                登录后可在「用户管理」中创建单位管理员并分配权限
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
