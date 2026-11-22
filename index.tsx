import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  declare state: ErrorBoundaryState;
  declare props: { children: React.ReactNode };

  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected rendering error occurred.'
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[App ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-3xl border border-gray-200 shadow-xl p-8 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-red-50 text-red-600 flex items-center justify-center text-2xl font-black border border-red-100">
              !
            </div>
            <h1 className="text-xl font-black text-gray-900">Something went wrong</h1>
            <p className="text-xs text-gray-500 leading-relaxed break-words">
              An unexpected error occurred while rendering this view. Please reload the application to continue.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-3 rounded-xl bg-gray-900 hover:bg-black text-white font-bold text-sm transition cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);