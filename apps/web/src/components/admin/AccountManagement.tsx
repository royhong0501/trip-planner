import { useState, useEffect, useRef, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, KeyRound, X, Check } from 'lucide-react';
import { listUsers, createUser, updateUserPassword, deleteUser, getSession } from '@/lib/auth';

const AccountManagement = () => {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [changingPasswordId, setChangingPasswordId] = useState<string | null>(null);
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: listUsers,
  });

  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: getSession,
  });

  const currentUserId = session?.user?.id;

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback({ type, msg });
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3000);
  };

  const createMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      createUser(email, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setNewEmail('');
      setNewPass('');
      setShowAdd(false);
      showFeedback('success', '帳號新增成功');
    },
    onError: (e: Error) => showFeedback('error', e.message),
  });

  const updatePasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      updateUserPassword(userId, password),
    onSuccess: () => {
      setChangingPasswordId(null);
      setNewPasswordValue('');
      showFeedback('success', '密碼修改成功');
    },
    onError: (e: Error) => showFeedback('error', e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      showFeedback('success', '帳號已刪除');
    },
    onError: (e: Error) => showFeedback('error', e.message),
  });

  const handleAdd = () => {
    if (!newEmail.trim() || !newPass.trim()) return;
    createMutation.mutate({ email: newEmail.trim(), password: newPass.trim() });
  };

  const handleChangePassword = (userId: string) => {
    if (!newPasswordValue.trim()) return;
    updatePasswordMutation.mutate({ userId, password: newPasswordValue.trim() });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-muted-foreground text-sm">管理後台登入之帳號密碼</p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 px-4 py-2 rounded-lg bg-action text-action-foreground text-sm font-medium hover:bg-action/90"
        >
          <Plus className="h-4 w-4" /> 新增帳號
        </button>
      </div>

      {feedback && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${
            feedback.type === 'success'
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {showAdd && (
        <div className="bg-muted rounded-lg p-4 mb-4 flex flex-col sm:flex-row gap-3">
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Email（帳號）"
            type="email"
            className="flex-1 px-3 py-2 rounded-md border bg-background text-foreground text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            placeholder="密碼"
            type="password"
            className="flex-1 px-3 py-2 rounded-md border bg-background text-foreground text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={createMutation.isPending}
              className="px-4 py-2 rounded-md bg-action text-action-foreground text-sm hover:bg-action/90 disabled:opacity-50"
            >
              {createMutation.isPending ? '新增中...' : '確認'}
            </button>
            <button
              onClick={() => { setShowAdd(false); setNewEmail(''); setNewPass(''); }}
              className="px-4 py-2 rounded-md bg-muted text-muted-foreground text-sm border"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="text-center text-muted-foreground text-sm py-8">載入中...</p>
        ) : (
          <table className="w-full text-sm text-table-foreground">
            <thead>
              <tr className="border-b border-border bg-table-header">
                <th className="text-left px-4 py-3 text-table-header-foreground font-medium">Email</th>
                <th className="text-left px-4 py-3 text-table-header-foreground font-medium hidden sm:table-cell">建立時間</th>
                <th className="text-right px-4 py-3 text-table-header-foreground font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <Fragment key={user.id}>
                  <tr className="border-b border-border/60 bg-table">
                    <td className="px-4 py-3 text-foreground">
                      {user.email}
                      {user.id === currentUserId && (
                        <span className="ml-2 text-xs text-muted-foreground">(目前登入)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                      {new Date(user.created_at).toLocaleDateString('zh-TW')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setChangingPasswordId(changingPasswordId === user.id ? null : user.id);
                            setNewPasswordValue('');
                          }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="修改密碼"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        {user.id !== currentUserId && (
                          <button
                            onClick={() => deleteMutation.mutate(user.id)}
                            disabled={deleteMutation.isPending}
                            className="text-destructive hover:text-destructive/80 disabled:opacity-50"
                            title="刪除帳號"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {changingPasswordId === user.id && (
                    <tr className="border-b border-border/50 bg-muted/30">
                      <td colSpan={3} className="px-4 py-3">
                        <div className="flex gap-2 items-center">
                          <input
                            value={newPasswordValue}
                            onChange={(e) => setNewPasswordValue(e.target.value)}
                            placeholder="輸入新密碼"
                            type="password"
                            className="flex-1 px-3 py-1.5 rounded-md border bg-background text-foreground text-sm outline-none focus:ring-1 focus:ring-ring"
                          />
                          <button
                            onClick={() => handleChangePassword(user.id)}
                            disabled={updatePasswordMutation.isPending}
                            className="text-secondary hover:text-secondary/80 disabled:opacity-50"
                            title="確認修改"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => { setChangingPasswordId(null); setNewPasswordValue(''); }}
                            className="text-muted-foreground hover:text-foreground"
                            title="取消"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center text-muted-foreground py-8">
                    尚無帳號
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default AccountManagement;
