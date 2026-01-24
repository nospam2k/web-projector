import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import LiveDisplay from './LiveDisplay.jsx'
import PlainDisplay from './PlainDisplay.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/live" element={<LiveDisplay />} />
        <Route path="/plain" element={<PlainDisplay />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
