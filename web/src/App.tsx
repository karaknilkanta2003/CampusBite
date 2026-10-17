import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './session';
import { Spinner } from './components/ui';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { CanteenPage } from './pages/CanteenPage';
import { Checkout } from './pages/Checkout';
import { OrderPage } from './pages/OrderPage';
import { Orders } from './pages/Orders';
import { Profile } from './pages/Profile';
import { Kitchen, KitchenRedirect } from './pages/Kitchen';
import { Board } from './pages/Board';
import { Admin } from './pages/Admin';

export function App() {
  const { loading } = useSession();
  if (loading) return <Spinner />;
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/c/:id" element={<CanteenPage />} />
      <Route path="/c/:id/checkout" element={<Checkout />} />
      <Route path="/orders" element={<Orders />} />
      <Route path="/orders/:id" element={<OrderPage />} />
      <Route path="/me" element={<Profile />} />
      <Route path="/kitchen" element={<KitchenRedirect />} />
      <Route path="/kitchen/:id" element={<Kitchen />} />
      <Route path="/board/:id" element={<Board />} />
      <Route path="/admin/*" element={<Admin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
