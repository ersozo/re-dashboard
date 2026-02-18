import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

const ErrorScreen = ({ error }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
      <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-full mb-4">
        <AlertTriangle className="text-red-500 dark:text-red-400" size={32} />
      </div>
      <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">Hata Oluştu</h3>
      <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">{error || 'Veriler yüklenirken bir problem yaşandı.'}</p>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold transition-colors shadow-lg shadow-blue-200 dark:shadow-blue-900/30"
      >
        <RefreshCw size={18} />
        <span>Tekrar Dene</span>
      </button>
    </div>
  )
}

export default ErrorScreen
