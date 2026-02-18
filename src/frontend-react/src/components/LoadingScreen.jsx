import React from 'react'

const LoadingScreen = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px]">
      <div className="relative w-16 h-16">
        <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-100 dark:border-slate-700 rounded-full"></div>
        <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-600 dark:border-blue-400 rounded-full border-t-transparent animate-spin"></div>
      </div>
      <p className="mt-4 text-gray-500 dark:text-gray-400 font-medium animate-pulse">Veriler hazırlanıyor...</p>
    </div>
  )
}

export default LoadingScreen
