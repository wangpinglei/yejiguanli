import { useState } from "react";
import { Link, useLocation, useNavigate, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Building2,
  Users,
  ShoppingCart,
  Wallet,
  TrendingUp,
  Package,
  LogOut,
  Menu,
  ChevronDown,
  BarChart3,
  ShieldCheck,
  Bell,
  CheckCheck,
  Swords,
} from "lucide-react";
import { useAuth, ROLE_LABELS } from "@/context/AuthContext";
import { useData } from "@/context/DataContext";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  superadminOnly?: boolean;
}

const navItems: NavItem[] = [
  { path: "/", label: "数据看板", icon: LayoutDashboard },
  { path: "/sales-units", label: "销售单位", icon: Building2 },
  { path: "/personnel", label: "人员管理", icon: Users },
  { path: "/products", label: "产品管理", icon: Package },
  { path: "/sales-records", label: "销售记录", icon: ShoppingCart },
  { path: "/cost-management", label: "成本管理", icon: Wallet },
  { path: "/profit-analysis", label: "收支利润", icon: TrendingUp },
  { path: "/sales-battle-report", label: "单位战报", icon: Swords },
  { path: "/users", label: "用户管理", icon: ShieldCheck, superadminOnly: true },
];

const roleAvatarColors: Record<string, string> = {
  superadmin: "bg-violet-500 text-white",
  group_admin: "bg-indigo-500 text-white",
  military_cadre: "bg-amber-500 text-white",
  org_department: "bg-cyan-500 text-white",
  unit_leader: "bg-emerald-500 text-white",
  unit_manager: "bg-blue-500 text-white",
};

function SidebarContent({ onNavigate, isSuperadmin }: { onNavigate?: () => void; isSuperadmin: boolean }) {
  const location = useLocation();

  const visibleItems = navItems.filter((item) => !item.superadminOnly || isSuperadmin);

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
          <BarChart3 className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-white">业绩管理系统</h1>
          <p className="text-xs text-white/50">Performance Manager</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
              {item.superadminOnly && (
                <ShieldCheck className="ml-auto h-3 w-3 text-white/40" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 p-4">
        <p className="text-xs text-white/40">© 2025 业绩管理系统</p>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isSuperadmin = user?.role === "superadmin";

  const pageTitle =
    navItems.find((item) => item.path === location.pathname)?.label || "数据看板";

  const roleLabel = user ? ROLE_LABELS[user.role] : "";
  const avatarColor = user ? (roleAvatarColors[user.role] || "bg-primary text-primary-foreground") : "";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 bg-sidebar lg:block">
        <SidebarContent isSuperadmin={isSuperadmin} />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar">
          <SidebarContent onNavigate={() => setMobileOpen(false)} isSuperadmin={isSuperadmin} />
        </SheetContent>
      </Sheet>

      {/* Main Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
            </Sheet>
            <h2 className="text-lg font-semibold">{pageTitle}</h2>
          </div>

          <div className="flex items-center gap-3">
            {/* 通知铃铛（仅超管） */}
            {isSuperadmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-96 max-h-[500px] overflow-y-auto">
                  <DropdownMenuLabel className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Bell className="h-4 w-4" />
                      成本变更通知
                    </span>
                    {unreadCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={markAllNotificationsRead}
                      >
                        <CheckCheck className="mr-1 h-3 w-3" />
                        全部已读
                      </Button>
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      <Bell className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      暂无通知
                    </div>
                  ) : (
                    notifications.slice(0, 50).map((notif) => (
                      <DropdownMenuItem
                        key={notif.id}
                        className="flex-col items-start py-3 cursor-pointer"
                        onClick={() => markNotificationRead(notif.id)}
                      >
                        <div className="flex w-full items-start gap-2">
                          {!notif.read && (
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                          )}
                          <div className={cn("flex-1", notif.read && "ml-4 opacity-60")}>
                            <p className="text-sm font-medium">{notif.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {formatDateTime(notif.timestamp)}
                            </p>
                          </div>
                        </div>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2 px-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className={cn("text-xs", avatarColor)}>
                      {user?.name?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden text-left sm:block">
                    <p className="text-sm font-medium leading-none">{user?.name}</p>
                    <p className="text-xs text-muted-foreground">{roleLabel}</p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>
                  <p className="text-sm font-medium">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">@{user?.username}</p>
                  <p className="text-xs text-primary mt-1">{roleLabel}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-thin">
          <div className="mx-auto max-w-7xl animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
