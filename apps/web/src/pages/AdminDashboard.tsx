import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Users, Home, MapPinned, LogOut, ExternalLink } from 'lucide-react';
import AccountManagement from '@/components/admin/AccountManagement';
import HomepageManagement from '@/components/admin/HomepageManagement';
import TripManagement from '@/components/admin/TripManagement';
import { getSession, signOut } from '@/lib/auth';
import { useSiteDisplayTitle } from '@/hooks/useSiteDisplayTitle';

type AdminPage = 'accounts' | 'homepage' | 'trips';

const ADMIN_PAGES: readonly AdminPage[] = ['accounts', 'homepage', 'trips'] as const;
const DEFAULT_PAGE: AdminPage = 'accounts';

const menuItems: { key: AdminPage; label: string; icon: React.ElementType }[] = [
  { key: 'accounts', label: '帳號管理', icon: Users },
  { key: 'homepage', label: '網站管理', icon: Home },
  { key: 'trips', label: '行程管理', icon: MapPinned },
];

const AdminDashboard = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activePage: AdminPage = (ADMIN_PAGES as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as AdminPage)
    : DEFAULT_PAGE;
  const setActivePage = (key: AdminPage) => {
    // replace:true 讓切 tab 不塞滿瀏覽器歷史（back 鈕跳回上一頁而非上個 tab）
    setSearchParams(key === DEFAULT_PAGE ? {} : { tab: key }, { replace: true });
  };
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();
  const siteDisplayTitle = useSiteDisplayTitle();

  useEffect(() => {
    getSession().then((session) => {
      if (!session) {
        navigate('/admin/login');
      }
      setChecking(false);
    });
  }, [navigate]);

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">驗證中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-56' : 'w-16'} bg-primary text-primary-foreground transition-all duration-300 flex flex-col shrink-0`}>
        <div className="h-16 flex items-center justify-start border-b border-sidebar-border pl-5 pr-2">
          {sidebarOpen && <span className="text-lg font-bold text-[#695D54]">{siteDisplayTitle}</span>}
        </div>
        <nav className="flex-1 py-4 space-y-1 px-2">
          {menuItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActivePage(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                activePage === item.key
                  ? 'bg-sidebar-accent text-sidebar-primary'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
              }`}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className="px-2 pb-4 space-y-1">
          <a
            href="#/"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors no-underline"
          >
            <ExternalLink className="h-5 w-5 shrink-0" />
            {sidebarOpen && <span>前往前台</span>}
          </a>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {sidebarOpen && <span>登出</span>}
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0">
        <header className="h-16 border-b border-border flex items-center px-6">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="mr-4 text-muted-foreground hover:text-foreground">
            ☰
          </button>
          <h1 className="text-lg font-semibold text-foreground">
            {menuItems.find((m) => m.key === activePage)?.label}
          </h1>
        </header>
        <div className="p-6">
          {activePage === 'accounts' && <AccountManagement />}
          {activePage === 'homepage' && <HomepageManagement />}
          {activePage === 'trips' && <TripManagement />}
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
