import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { BUSINESS_NAME } from '../constants';

export const AuthScreen: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, signInWithGoogle } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        if (!displayName.trim()) {
          setError('Please enter your business name');
          setLoading(false);
          return;
        }
        await signUp(email, password, displayName);
      }
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('Email already in use. Please sign in instead.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address.');
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Invalid email or password.');
      } else {
        setError(err.message || 'An error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || 'Failed to sign in with Google');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-gray-800 p-6">
      <div className="max-w-md w-full bg-white rounded-[3rem] p-10 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <i className="fas fa-truck-fast text-[#FFD700] text-5xl mb-4"></i>
          <h1 className="text-3xl font-black uppercase tracking-tighter">{BUSINESS_NAME}</h1>
          <p className="text-gray-400 text-xs font-black uppercase tracking-widest mt-2">
            {isLogin ? 'Welcome Back' : 'Create Business Account'}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border-2 border-red-200 text-red-600 p-4 rounded-2xl mb-6 text-sm font-bold">
            <i className="fas fa-exclamation-circle mr-2"></i>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-3">
                Business Name
              </label>
              <input
                type="text"
                placeholder="Enter your business name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold transition-all"
                required={!isLogin}
                disabled={loading}
              />
            </div>
          )}

          <div>
            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-3">
              Email Address
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold transition-all"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-3">
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#FFD700] focus:border-[#FFD700] outline-none font-bold transition-all"
              required
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-black text-[#FFD700] font-black uppercase tracking-widest text-sm rounded-2xl hover:bg-gray-900 transition-all shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Processing...
              </>
            ) : (
              <>{isLogin ? 'Sign In' : 'Create Business Account'}</>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t-2 border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-4 text-gray-400 font-black tracking-widest">Or</span>
            </div>
          </div>

          {/* Google Sign In */}
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="mt-6 w-full py-4 bg-white border-2 border-gray-200 text-black font-black uppercase tracking-widest text-sm rounded-2xl hover:border-black transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fab fa-google text-[#FFD700] text-lg"></i>
            Continue with Google
          </button>
        </div>

        {/* Toggle Login/Signup */}
        <button
          onClick={() => {
            setIsLogin(!isLogin);
            setError('');
          }}
          disabled={loading}
          className="mt-6 w-full text-sm text-gray-500 hover:text-black font-bold transition-colors"
        >
          {isLogin
            ? "Don't have an account? Create Business Account"
            : 'Already have an account? Sign In'}
        </button>

        {/* Footer Note */}
        {!isLogin && (
          <div className="mt-6 p-4 bg-gray-50 rounded-2xl">
            <p className="text-[9px] text-gray-400 text-center font-bold leading-relaxed">
              By creating an account, you'll get access to fleet management, route tracking, smart ordering, and more. Your demo data will be automatically set up.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
