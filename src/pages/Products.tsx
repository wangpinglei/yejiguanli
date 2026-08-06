import { Navigate } from "react-router-dom";

/** 产品管理已并入「产品结算设置」，旧路由重定向 */
export default function Products() {
  return <Navigate to="/product-settlement" replace />;
}
