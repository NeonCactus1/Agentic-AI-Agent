import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ChatApp from './chat.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ChatApp />
  </StrictMode>,
)
