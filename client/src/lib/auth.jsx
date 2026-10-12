import { createContext, useContext, useEffect, useState } from 'react';
import { api, onUnauthorized } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking

  useEffect(() => {
    api.get('/auth/me').then(setUser).catch(() => setUser(null));
    return onUnauthorized(() => setUser(null));
  }, []);

  const value = {
    user,
    login: async (email, password) => setUser(await api.post('/auth/login', { email, password })),
    signup: async (name, email, password) => setUser(await api.post('/auth/signup', { name, email, password })),
    logout: async () => {
      await api.post('/auth/logout').catch(() => {});
      setUser(null);
    },
    clear: () => setUser(null),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
