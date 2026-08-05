import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { DataProvider } from "@/context/DataContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import SalesUnits from "@/pages/SalesUnits";
import Personnel from "@/pages/Personnel";
import Products from "@/pages/Products";
import SalesRecords from "@/pages/SalesRecords";
import CostManagement from "@/pages/CostManagement";
import ProfitAnalysis from "@/pages/ProfitAnalysis";
import SalesBattleReport from "@/pages/SalesBattleReport";
import UserManagement from "@/pages/UserManagement";
import ProductSettlement from "@/pages/ProductSettlement";
import type { ReactNode } from "react";

function SuperadminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "superadmin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <BrowserRouter basename="/yeji">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="sales-units" element={<SalesUnits />} />
              <Route path="personnel" element={<Personnel />} />
              <Route path="products" element={<Products />} />
              <Route path="sales-records" element={<SalesRecords />} />
              <Route path="cost-management" element={<CostManagement />} />
              <Route path="profit-analysis" element={<ProfitAnalysis />} />
              <Route path="sales-battle-report" element={<SalesBattleReport />} />
              <Route path="product-settlement" element={<ProductSettlement />} />
              <Route
                path="users"
                element={
                  <SuperadminRoute>
                    <UserManagement />
                  </SuperadminRoute>
                }
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </DataProvider>
    </AuthProvider>
  );
}
