import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { BarChart3 } from "lucide-react";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  // token 验证中，显示加载画面
  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
          <BarChart3 className="h-7 w-7 text-primary-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">正在加载...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
